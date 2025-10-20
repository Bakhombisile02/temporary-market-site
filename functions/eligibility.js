const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const admin = require('firebase-admin')

const ELIGIBILITY_DATA = require('./data/eligibility-questions.json')

const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F]/g
const DEFAULT_STORAGE_PATH = 'eligibility_submissions'
const DEFAULT_FILE_STORAGE_PATH = 'data/eligibility_submissions.jsonl'
const FILE_STORAGE_MODE = 'file'
const MAX_OPTIONAL_LENGTH = 250
const LOCK_RETRY_ATTEMPTS = 10
const LOCK_RETRY_DELAY = 25

const COUNTRIES = new Map(
  (ELIGIBILITY_DATA.countries || []).map((country) => [country.name, country])
)

const sanitizeString = (value) => {
  if (!value || typeof value !== 'string') {
    return ''
  }
  return value.replace(CONTROL_CHAR_PATTERN, '').trim()
}

const normalizeAnswer = (value) => {
  if (!value) {
    return null
  }
  const normalized = value.toString().trim().toLowerCase()
  if (normalized === 'yes') {
    return 'Yes'
  }
  if (normalized === 'no') {
    return 'No'
  }
  return null
}

const enforceOptionalLimit = (value) => {
  if (!value) {
    return null
  }
  const trimmed = sanitizeString(value)
  if (!trimmed) {
    return null
  }
  return trimmed.length > MAX_OPTIONAL_LENGTH ? trimmed.slice(0, MAX_OPTIONAL_LENGTH) : trimmed
}

const prepareQuestions = (countryData, submittedQuestions = []) => {
  const errors = []
  const normalizedQuestions = []
  const expectedQuestions = countryData.questions

  if (
    !Array.isArray(submittedQuestions) ||
    submittedQuestions.length !== expectedQuestions.length
  ) {
    throw createValidationError('Invalid number of questions received for the selected country.')
  }

  submittedQuestions.forEach((incoming, index) => {
    const expectedText = expectedQuestions[index]
    const questionText = sanitizeString(incoming?.question_text || incoming?.questionText || '')
    const normalizedAnswer = normalizeAnswer(incoming?.answer)
    const optionalText = enforceOptionalLimit(incoming?.optional_text ?? incoming?.optionalText)

    if (questionText !== expectedText) {
      throw createValidationError('Submitted questions do not match the expected screening order.')
    }

    if (!normalizedAnswer) {
      errors.push({
        question_index: index,
        error_type: incoming?.answer ? 'InvalidAnswer' : 'MissingAnswer',
        message: 'Please choose Yes or No'
      })
    }

    normalizedQuestions.push({
      question_text: expectedText,
      answer: normalizedAnswer || 'No',
      optional_text: optionalText,
      eligibility_passed: normalizedAnswer === 'Yes'
    })
  })

  return { normalizedQuestions, errors }
}

const determineSummary = (questions, errors) => {
  if (errors.length) {
    return "Incomplete Submission – Please Answer All Questions with 'Yes' or 'No'"
  }
  const hasNo = questions.some((entry) => entry.answer === 'No')
  if (hasNo) {
    return 'Potential Eligibility Issues'
  }
  return 'Likely Eligible for Early Access'
}

const createValidationError = (message) => {
  const error = new Error(message)
  error.status = 400
  return error
}

const acquireLock = async (lockPath, attempt = 0) => {
  try {
    return await fs.open(lockPath, 'wx')
  } catch (error) {
    if ((error.code === 'EEXIST' || error.code === 'EACCES') && attempt < LOCK_RETRY_ATTEMPTS) {
      await delay(LOCK_RETRY_DELAY * (attempt + 1))
      return acquireLock(lockPath, attempt + 1)
    }
    throw error
  }
}

const releaseLock = async (handle, lockPath) => {
  if (handle) {
    await handle.close().catch(() => {})
  }
  try {
    await fs.unlink(lockPath)
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error
    }
  }
}

const appendJsonLine = async (filePath, line) => {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true })
  const lockPath = `${filePath}.lock`
  const lockHandle = await acquireLock(lockPath)
  const tempPath = path.join(
    directory,
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  )

  try {
    const fileExists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false)

    if (!fileExists) {
      await fs.writeFile(tempPath, `${line}\n`, { encoding: 'utf8' })
      await fs.rename(tempPath, filePath)
      const fileHandle = await fs.open(filePath, 'r')
      try {
        await fileHandle.sync()
      } finally {
        await fileHandle.close()
      }
    } else {
      await fs.writeFile(tempPath, `${line}\n`, { encoding: 'utf8' })
      const fileHandle = await fs.open(filePath, 'a')
      try {
        await fileHandle.writeFile(await fs.readFile(tempPath))
        await fileHandle.sync()
      } finally {
        await fileHandle.close()
        await fs.unlink(tempPath).catch(() => {})
      }
    }
  } finally {
    await fs.unlink(tempPath).catch(() => {})
    await releaseLock(lockHandle, lockPath)
  }
}

const resolveFileStoragePath = (customPath) => {
  const target = customPath || DEFAULT_FILE_STORAGE_PATH
  return path.resolve(__dirname, target)
}

const shouldUseFileStorage = (customPath) => {
  const mode = (process.env.ELIGIBILITY_STORAGE_MODE || '').toLowerCase()
  if (mode === FILE_STORAGE_MODE) {
    return true
  }
  if (!customPath) {
    return false
  }
  return /\.jsonl?$/.test(customPath)
}

const sanitizeStoragePath = (value) => {
  if (!value || typeof value !== 'string') {
    return ''
  }
  return value
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/')
}

const sanitizeIdentifier = (value) => {
  if (!value || typeof value !== 'string') {
    return ''
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '')
}

const buildStorageObjectPath = (customPath, record) => {
  const base = sanitizeStoragePath(customPath) || DEFAULT_STORAGE_PATH
  const timestamp = new Date(record.timestamp_iso || Date.now())
    .toISOString()
    .replace(/[:.]/g, '-')
  const identifier =
    sanitizeIdentifier(record.submission_id) || sanitizeIdentifier(crypto.randomUUID())
  return `${base}/${timestamp}-${identifier}.json`
}

let cachedStorageBucket = null

const getStorageBucket = () => {
  if (!admin.apps.length) {
    admin.initializeApp()
  }
  if (!cachedStorageBucket) {
    const bucketName =
      process.env.ELIGIBILITY_STORAGE_BUCKET || process.env.FIREBASE_STORAGE_BUCKET
    cachedStorageBucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket()
  }
  return cachedStorageBucket
}

const storeInBucket = async (record, customPath) => {
  const bucket = getStorageBucket()
  const objectPath = buildStorageObjectPath(customPath, record)
  const file = bucket.file(objectPath)
  await file.save(JSON.stringify(record), {
    contentType: 'application/json',
    resumable: false
  })
  return `gs://${bucket.name}/${objectPath}`
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const prepareSubmission = (payload = {}) => {
  const countryName = sanitizeString(payload.country)
  if (!countryName) {
    throw createValidationError('Country is required.')
  }
  const countryData = COUNTRIES.get(countryName)
  if (!countryData) {
    throw createValidationError('Unsupported country provided.')
  }

  const { normalizedQuestions, errors } = prepareQuestions(countryData, payload.questions)

  const submissionRecord = {
    timestamp_iso: new Date().toISOString(),
    submission_id: crypto.randomUUID(),
    session_id: sanitizeString(payload.session_id || payload.sessionId),
    country: countryData.name,
    questions: normalizedQuestions,
    errors
  }

  if (!submissionRecord.session_id) {
    errors.push({
      question_index: -1,
      error_type: 'InvalidSession',
      message: 'Session identifier is required.'
    })
  }

  const overallSummary = determineSummary(normalizedQuestions, errors)

  const response = {
    country: countryData.name,
    questions: normalizedQuestions,
    overall_summary: overallSummary,
    errors
  }

  submissionRecord.overall_summary = overallSummary

  return { response, submissionRecord }
}

const storeSubmission = async (record, customPath) => {
  if (shouldUseFileStorage(customPath)) {
    const storagePath = resolveFileStoragePath(customPath)
    const line = JSON.stringify(record)
    await appendJsonLine(storagePath, line)
    return storagePath
  }

  return storeInBucket(record, customPath)
}

module.exports = {
  DEFAULT_STORAGE_PATH,
  prepareSubmission,
  storeSubmission,
  determineSummary,
  normalizeAnswer,
  enforceOptionalLimit,
  appendJsonLine,
  delay,
  __data: {
    COUNTRIES
  }
}
