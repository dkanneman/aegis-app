import {
  AEGIS_APPOINTMENT_HEADERS,
  AegisDestinationConfig,
  AegisSheetRow,
  AegisSheetsError,
  AegisSheetsGateway,
  validateAegisDestinationConfig,
} from './sheets.ts'

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

type ServiceAccount = {
  client_email?: string
  private_key?: string
  token_uri?: string
}

function base64Url(input: Uint8Array | string) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function pemBytes(value: string) {
  const encoded = value
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  if (!encoded) throw new AegisSheetsError(401, 'service_account_invalid', 'The service-account private key is missing.')
  const binary = atob(encoded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function parseServiceAccount(raw: string): Required<ServiceAccount> {
  let account: ServiceAccount
  try {
    account = JSON.parse(raw)
  } catch {
    throw new AegisSheetsError(401, 'service_account_invalid', 'The service-account configuration is invalid JSON.')
  }
  if (!account.client_email || !account.private_key) {
    throw new AegisSheetsError(401, 'service_account_invalid', 'The service-account configuration is incomplete.')
  }
  return {
    client_email: account.client_email,
    private_key: account.private_key,
    token_uri: account.token_uri || TOKEN_ENDPOINT,
  }
}

async function serviceAccountAccessToken(raw: string) {
  const account = parseServiceAccount(raw)
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: SHEETS_SCOPE,
    aud: account.token_uri,
    iat: now,
    exp: now + 3600,
  }))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  )
  const assertion = `${header}.${payload}.${base64Url(new Uint8Array(signature))}`
  const response = await fetch(account.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await response.json().catch(() => ({})) as { access_token?: string }
  if (!response.ok || !data.access_token) {
    throw new AegisSheetsError(response.status || 502, 'service_account_token_failed', 'Google did not authorize the AEGIS writer.')
  }
  return data.access_token
}

function sheetRange(sheetName: string, range: string) {
  return `'${sheetName.replace(/'/g, "''")}'!${range}`
}

function rowNumberFromRange(range: unknown) {
  const match = String(range || '').match(/![A-Z]+(\d+):/i)
  const rowNumber = Number(match?.[1] || 0)
  if (!rowNumber) throw new AegisSheetsError(502, 'append_result_invalid', 'Google Sheets did not return the appended row number.')
  return rowNumber
}

export function createAegisSheetsGateway(config: AegisDestinationConfig): AegisSheetsGateway {
  validateAegisDestinationConfig(config)
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values`
  let cachedToken = ''

  const request = async (url: string, init: RequestInit = {}) => {
    if (!cachedToken) cachedToken = await serviceAccountAccessToken(config.serviceAccountJson)
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${cachedToken}`)
    headers.set('content-type', 'application/json')
    let response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) })
    if (response.status === 401) {
      cachedToken = await serviceAccountAccessToken(config.serviceAccountJson)
      headers.set('authorization', `Bearer ${cachedToken}`)
      response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) })
    }
    const data = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) {
      throw new AegisSheetsError(response.status, 'sheets_api_failed', `Google Sheets returned ${response.status}.`)
    }
    return data
  }

  const readAll = async () => {
    const range = sheetRange(config.sheetName, `A:${String.fromCharCode(64 + AEGIS_APPOINTMENT_HEADERS.length)}`)
    const data = await request(`${base}/${encodeURIComponent(range)}`)
    const values = Array.isArray(data.values) ? data.values as unknown[][] : []
    const headers = (values[0] || []).map(String)
    if (headers.length !== AEGIS_APPOINTMENT_HEADERS.length
      || !AEGIS_APPOINTMENT_HEADERS.every((header, index) => headers[index] === header)) {
      throw new AegisSheetsError(409, 'invalid_sheet_schema', 'The AEGIS tab headers do not exactly match the required 19-column appointment schema.')
    }
    return values.slice(1).map((row, index) => ({
      rowNumber: index + 2,
      values: row.map((value) => String(value ?? '')),
    }))
  }

  return {
    async findRowsByRecordId(recordId: string): Promise<AegisSheetRow[]> {
      return (await readAll()).filter((row) => row.values[0] === recordId)
    },
    async appendRow(values: string[]) {
      const range = sheetRange(config.sheetName, 'A:A')
      const url = new URL(`${base}/${encodeURIComponent(range)}:append`)
      url.searchParams.set('valueInputOption', 'RAW')
      url.searchParams.set('insertDataOption', 'INSERT_ROWS')
      const data = await request(url.toString(), {
        method: 'POST',
        body: JSON.stringify({ majorDimension: 'ROWS', values: [values] }),
      })
      return rowNumberFromRange((data.updates as { updatedRange?: unknown } | undefined)?.updatedRange)
    },
    async updateRow(rowNumber: number, values: string[]) {
      const range = sheetRange(config.sheetName, `A${rowNumber}:${String.fromCharCode(64 + AEGIS_APPOINTMENT_HEADERS.length)}${rowNumber}`)
      const url = new URL(`${base}/${encodeURIComponent(range)}`)
      url.searchParams.set('valueInputOption', 'RAW')
      await request(url.toString(), {
        method: 'PUT',
        body: JSON.stringify({ majorDimension: 'ROWS', values: [values] }),
      })
    },
    async readRow(rowNumber: number) {
      const range = sheetRange(config.sheetName, `A${rowNumber}:${String.fromCharCode(64 + AEGIS_APPOINTMENT_HEADERS.length)}${rowNumber}`)
      const data = await request(`${base}/${encodeURIComponent(range)}`)
      const values = Array.isArray(data.values) ? data.values as unknown[][] : []
      return (values[0] || []).map((value) => String(value ?? ''))
    },
  }
}
