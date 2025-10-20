process.env.ELIGIBILITY_STORAGE_MODE = 'file'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const fs = require('fs/promises')
const os = require('os')

const eligibility = require('../eligibility')

const siteDataPath = path.resolve(
  __dirname,
  '../../site/_website_settings/eligibility_questions.json'
)
const functionDataPath = path.resolve(__dirname, '../data/eligibility-questions.json')

const getCountryPayload = (countryName, answers) => {
  const country = eligibility.__data.COUNTRIES.get(countryName)
  assert.ok(country, `Expected country data for ${countryName}`)
  return {
    session_id: 'test-session-123',
    country: countryName,
    questions: country.questions.map((question_text, index) => ({
      question_text,
      answer: answers[index] ?? 'Yes',
      optional_text: null
    }))
  }
}

test('front-end and function eligibility data stay in sync', async () => {
  const [siteJson, functionJson] = await Promise.all([
    fs.readFile(siteDataPath, 'utf8'),
    fs.readFile(functionDataPath, 'utf8')
  ])

  assert.deepEqual(JSON.parse(functionJson), JSON.parse(siteJson))
})

test('prepareSubmission returns likely eligible when all answers are yes', () => {
  const payload = getCountryPayload('Australia', ['Yes', 'Yes', 'Yes', 'Yes', 'Yes'])
  const { response, submissionRecord } = eligibility.prepareSubmission(payload)

  assert.equal(response.overall_summary, 'Likely Eligible for Early Access')
  assert.equal(response.errors.length, 0)
  assert.equal(submissionRecord.questions.length, 5)
  submissionRecord.questions.forEach((entry) => {
    assert.equal(entry.answer, 'Yes')
    assert.equal(entry.eligibility_passed, true)
  })
})

test('prepareSubmission flags potential issues when any answer is no', () => {
  const payload = getCountryPayload('Canada', ['Yes', 'No', 'Yes', 'Yes', 'Yes'])
  const { response } = eligibility.prepareSubmission(payload)

  assert.equal(response.overall_summary, 'Potential Eligibility Issues')
  assert.equal(response.errors.length, 0)
  assert.equal(response.questions[1].answer, 'No')
  assert.equal(response.questions[1].eligibility_passed, false)
})

test('prepareSubmission returns errors when answers are missing', () => {
  const payload = getCountryPayload('Ireland', ['Yes', '', 'Yes', 'Yes', 'Yes'])
  const { response } = eligibility.prepareSubmission(payload)

  assert.equal(
    response.overall_summary,
    "Incomplete Submission – Please Answer All Questions with 'Yes' or 'No'"
  )
  assert.equal(response.errors.length, 1)
  assert.equal(response.errors[0].question_index, 1)
  assert.equal(response.errors[0].message, 'Please choose Yes or No')
})

test('prepareSubmission trims optional text and session errors', () => {
  const payload = getCountryPayload('New Zealand', ['Yes', 'Yes', 'Yes', 'Yes', 'Yes'])
  const longText = 'x'.repeat(260)
  payload.session_id = '  '
  payload.questions[0].optional_text = `  ${longText}`

  const { response } = eligibility.prepareSubmission(payload)
  assert.equal(response.questions[0].optional_text.length, 250)
  assert.equal(response.errors.length, 1)
  assert.equal(response.errors[0].error_type, 'InvalidSession')
  assert.equal(
    response.overall_summary,
    "Incomplete Submission – Please Answer All Questions with 'Yes' or 'No'"
  )
})

test('prepareSubmission throws for invalid country', () => {
  assert.throws(
    () => eligibility.prepareSubmission({ session_id: 'abc', country: 'Spain', questions: [] }),
    { status: 400, message: 'Unsupported country provided.' }
  )
})

test('storeSubmission writes json line to provided file', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eligibility-'))
  const target = path.join(tmpDir, 'eligibility.jsonl')

  const record = {
    timestamp_iso: new Date().toISOString(),
    submission_id: '12345',
    session_id: 'session-1',
    country: 'Australia',
    questions: [],
    overall_summary: 'Likely Eligible for Early Access',
    errors: []
  }

  await eligibility.storeSubmission(record, target)

  const written = await fs.readFile(target, 'utf8')
  assert.equal(written.trim(), JSON.stringify(record))
})
