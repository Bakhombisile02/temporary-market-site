'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  __test__: { sanitizeString, sanitizePayload, validatePayload, buildAllowedOrigins, withCors }
} = require('..')

const mockResponse = () => {
  const headers = {}
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
    set(key, value) {
      headers[key] = value
    },
    get headerValues() {
      return headers
    }
  }
}

test('sanitizeString removes control characters and trims', () => {
  const result = sanitizeString('\u0007hello\nworld  ')
  assert.equal(result, 'hello\nworld')
})

test('sanitizePayload normalizes aliases and enforces limits', () => {
  const payload = {
    title: ' A '.repeat(100),
    name: '  Jane Doe  ',
    email: 'USER@EXAMPLE.COM ',
    contact: '  +123 456 7890  ',
    business_name: '  Radley Technologies  '
  }

  const sanitized = sanitizePayload(payload)
  assert.equal(sanitized.name, 'Jane Doe')
  assert.equal(sanitized.email, 'user@example.com')
  assert.equal(sanitized.businessName, 'Radley Technologies')
  assert.ok(sanitized.title.length <= 120)
})

test('validatePayload enforces required fields and patterns', () => {
  const base = {
    title: 'Founder',
    name: 'Jane Doe',
    email: 'jane@example.com',
    contact: '+123 456 7890',
    businessName: 'Acme'
  }

  assert.equal(validatePayload(base), null)
  assert.match(validatePayload({ ...base, email: 'bad' }), /valid business email/i)
  assert.match(validatePayload({ ...base, contact: 'abc' }), /format is invalid/i)
  assert.match(validatePayload({ ...base, name: '' }), /Name is required/i)
})

test('buildAllowedOrigins merges defaults when config missing', () => {
  const defaults = buildAllowedOrigins(null)
  assert.ok(defaults.includes('https://radley.tax'))

  const custom = buildAllowedOrigins({
    pipedrive: { origins: 'https://one.test, https://two.test' }
  })
  assert.deepEqual(custom, ['https://one.test', 'https://two.test'])
})

test('withCors sets headers only for allowed origin', () => {
  const res = mockResponse()
  const req = {
    get: (header) => (header === 'origin' ? 'https://allowed.test' : undefined)
  }

  const origin = withCors(req, res, ['https://allowed.test'])
  assert.equal(origin, 'https://allowed.test')
  assert.equal(res.headerValues['Access-Control-Allow-Origin'], 'https://allowed.test')

  const resBlocked = mockResponse()
  const reqBlocked = {
    get: (header) => (header === 'origin' ? 'https://blocked.test' : undefined)
  }

  const originBlocked = withCors(reqBlocked, resBlocked, ['https://allowed.test'])
  assert.equal(originBlocked, 'https://blocked.test')
  assert.equal(resBlocked.headerValues['Access-Control-Allow-Origin'], undefined)
})
