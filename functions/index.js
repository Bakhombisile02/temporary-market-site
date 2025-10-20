const functions = require('firebase-functions')

const eligibility = require('./eligibility')

const API_BASE = 'https://api.pipedrive.com/v1'
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:6060',
  'https://staging.radley.tax',
  'https://radley.tax'
]
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F]/g
const EMAIL_PATTERN =
  /^(?:[a-zA-Z0-9_'^&\/+-])+(?:\.(?:[a-zA-Z0-9_'^&\/+-])+)*@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/
const CONTACT_PATTERN = /^[+()\d\-\s]{5,40}$/
const FIELD_LIMITS = {
  title: 120,
  name: 120,
  email: 160,
  contact: 40,
  businessName: 160
}

const sanitizeString = (value) => {
  if (!value || typeof value !== 'string') {
    return ''
  }
  return value.replace(CONTROL_CHAR_PATTERN, '').trim()
}

const enforceLimit = (value, limit) => {
  if (!value) {
    return ''
  }
  return value.length > limit ? value.slice(0, limit) : value
}

const buildAllowedOrigins = (config) => {
  const originsConfig = config?.pipedrive?.origins
  if (!originsConfig) {
    return DEFAULT_ALLOWED_ORIGINS
  }
  return originsConfig
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

const withCors = (req, res, allowedOrigins) => {
  const origin = req.get('origin')
  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
  }
  res.set('Vary', 'Origin')
  res.set('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  return origin
}

const sanitizePayload = (payload = {}) => {
  return {
    title: enforceLimit(sanitizeString(payload.title), FIELD_LIMITS.title),
    name: enforceLimit(sanitizeString(payload.name), FIELD_LIMITS.name),
    email: enforceLimit(sanitizeString(payload.email), FIELD_LIMITS.email).toLowerCase(),
    contact: enforceLimit(sanitizeString(payload.contact), FIELD_LIMITS.contact),
    businessName: enforceLimit(
      sanitizeString(payload.businessName || payload.business_name),
      FIELD_LIMITS.businessName
    )
  }
}

const validatePayload = ({ title, name, email, contact, businessName }) => {
  if (!name) {
    return 'Name is required.'
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    return 'A valid business email is required.'
  }
  if (contact && !CONTACT_PATTERN.test(contact)) {
    return 'Contact number format is invalid.'
  }
  if (title && title.length < 2) {
    return 'Title must be at least 2 characters if provided.'
  }
  if (businessName && businessName.length < 2) {
    return 'Business name must be at least 2 characters if provided.'
  }
  return null
}

const pipedriveFetch = async (path, options = {}) => {
  const token = process.env.PIPEDRIVE_API_TOKEN || functions.config().pipedrive?.token
  if (!token) {
    throw new Error('Missing Pipedrive API token configuration')
  }

  const { method = 'GET', body } = options
  const requestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    }
  }

  if (body && method !== 'GET') {
    requestInit.body = body
  }

  const url = new URL(`${API_BASE}${path}`)
  url.searchParams.set('api_token', token)

  const response = await fetch(url.toString(), requestInit)
  const payload = await response.json()

  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error || payload.error_info || 'Pipedrive request failed')
    error.status = response.status
    throw error
  }

  return payload
}

const ensureOrganization = async (name) => {
  if (!name) {
    return null
  }

  try {
    const search = await pipedriveFetch(
      `/organizations/search?term=${encodeURIComponent(name)}&fields=name&exact_match=1`
    )
    const existing = search?.data?.items?.[0]?.item?.id
    if (existing) {
      return existing
    }
  } catch (error) {
    functions.logger.warn('Unable to search organization', { error: error.message })
  }

  const create = await pipedriveFetch('/organizations', {
    method: 'POST',
    body: JSON.stringify({ name })
  })

  return create?.data?.id ?? null
}

const createPerson = async ({ name, email, contact, organizationId }) => {
  const payload = await pipedriveFetch('/persons', {
    method: 'POST',
    body: JSON.stringify({
      name,
      org_id: organizationId || undefined,
      email: email ? [{ value: email, primary: true }] : [],
      phone: contact ? [{ value: contact, label: 'work', primary: true }] : []
    })
  })

  return payload?.data?.id ?? null
}

const createLead = async ({
  title,
  businessName,
  name,
  personId,
  organizationId,
  contact,
  email
}) => {
  const leadTitle = businessName ? `${businessName} - ${name}` : `Waitlist - ${name}`
  const noteLines = [
    title ? `Title/Position: ${title}` : null,
    businessName ? `Business name: ${businessName}` : null,
    contact ? `Contact: ${contact}` : null,
    email ? `Business email: ${email}` : null
  ].filter(Boolean)

  await pipedriveFetch('/leads', {
    method: 'POST',
    body: JSON.stringify({
      title: leadTitle,
      person_id: personId || undefined,
      organization_id: organizationId || undefined,
      note: noteLines.join('\n'),
      source_name: 'Marketing Site Waitlist'
    })
  })
}

const waitlistHandler = async (req, res) => {
  const allowedOrigins = buildAllowedOrigins(functions.config())
  const origin = withCors(req, res, allowedOrigins)

  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed.' })
    return
  }

  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const payload = sanitizePayload(req.body)
  const validationError = validatePayload(payload)

  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }

  try {
    const organizationId = await ensureOrganization(payload.businessName)
    const personId = await createPerson({
      name: payload.name,
      email: payload.email,
      contact: payload.contact,
      organizationId
    })

    await createLead({
      title: payload.title,
      businessName: payload.businessName,
      name: payload.name,
      personId,
      organizationId,
      contact: payload.contact,
      email: payload.email
    })

    res.json({ success: true })
  } catch (error) {
    functions.logger.error('Failed to push waitlist entry to Pipedrive', {
      error: error.message,
      status: error.status
    })
    const status = error.status && error.status >= 400 ? error.status : 502
    res.status(status).json({ error: 'Failed to submit waitlist entry.' })
  }
}

const pipedriveWaitlistPublic = functions.https.onRequest(waitlistHandler)

const eligibilityHandler = async (req, res) => {
  const allowedOrigins = buildAllowedOrigins(functions.config())
  const origin = withCors(req, res, allowedOrigins)

  if (origin && !allowedOrigins.includes(origin)) {
    res.status(403).json({ error: 'Origin not allowed.' })
    return
  }

  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  try {
    const { response, submissionRecord } = eligibility.prepareSubmission(req.body)

    if (response.errors.length) {
      res.status(400).json(response)
      return
    }

    await eligibility.storeSubmission(
      submissionRecord,
      process.env.ELIGIBILITY_STORAGE_PATH ||
        process.env.ELIGIBILITY_JSON_PATH ||
        eligibility.DEFAULT_STORAGE_PATH
    )

    functions.logger.info('eligibility_submission_recorded', {
      submissionId: submissionRecord.submission_id
    })

    res.json(response)
  } catch (error) {
    if (error.status === 400) {
      res.status(400).json({
        country: req.body?.country,
        questions: [],
        overall_summary: "Incomplete Submission – Please Answer All Questions with 'Yes' or 'No'",
        errors: [
          {
            question_index: -1,
            error_type: 'InvalidRequest',
            message: error.message
          }
        ]
      })
      return
    }

    functions.logger.error('Failed to store eligibility submission', {
      error: error.message
    })
    res.status(502).json({ error: 'Failed to process eligibility submission.' })
  }
}

const eligibilitySubmissionPublic = functions.https.onRequest(eligibilityHandler)

module.exports = {
  pipedriveWaitlistPublic,
  eligibilitySubmissionPublic,
  __test__: {
    sanitizeString,
    sanitizePayload,
    validatePayload,
    buildAllowedOrigins,
    withCors
  }
}
