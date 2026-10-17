import { describe, expect, it } from 'vitest'

import { cdscoPdf, guessTemplate, iframeTarget, parseCdscoListing } from '../../../src/sources/cdsco-pdf.ts'
import { fakeHttp, fixtureText } from './fake-http.ts'

const listing = fixtureText('html', 'cdsco-alerts-listing.html')
const LISTING_URL = 'https://cdsco.gov.in/opencms/opencms/en/Notifications/Alerts/'
const DL = 'https://cdsco.gov.in/opencms/opencms/system/modules/CDSCO.WEB/elements/download_file_division.jsp?num_id='

describe('parseCdscoListing', () => {
  const entries = parseCdscoListing(listing)
  const byId = (id: string) => entries.find((e) => e.numId === id)

  it('keeps alert lists and drops unrelated notices', () => {
    expect(entries.length).toBeGreaterThan(150)
    const titles = entries.map((e) => e.title)
    expect(titles).not.toContain('Circular to all State/UT Licensing Authorities regarding recent revised GST rate Structure')
    expect(titles.some((t) => /BA-BE/.test(t))).toBe(false)
    expect(titles.some((t) => /^Availability of Not Standard Quality/.test(t))).toBe(false)
    expect(titles.some((t) => /Reward Scheme/.test(t))).toBe(false)
  })

  it('reads title, release date, num_id and month for the June 2025 notices', () => {
    expect(byId('MTI5Mjc=')).toEqual({
      title: 'CDSCO NSQ ALERT FOR THE MONTH OF June 2025',
      publishedAt: '2025-07-18',
      numId: 'MTI5Mjc=',
      downloadUrl: `${DL}MTI5Mjc=`,
      noticeYm: 202506,
      template: 'cdsco-modern',
    })
    expect(byId('MTI5NTk=')).toMatchObject({ title: 'List of spurious Drugs for the month of June-2025', noticeYm: 202506, template: 'cdsco-spurious' })
    expect(byId('MTI5MjY=')).toMatchObject({ title: 'STATE NSQ ALERT FOR THE MONTH OF June 2025', template: 'cdsco-state' })
  })

  it('guesses the legacy template for pre-2024 notices', () => {
    expect(byId('NTE4OQ==')).toMatchObject({ title: 'Drug Alert list for month of August 2019', noticeYm: 201908, template: 'cdsco-legacy', publishedAt: '2019-09-03' })
    expect(byId('MjI4NA==')).toMatchObject({ noticeYm: 201708, template: 'cdsco-legacy' })
  })

  it('repairs mis-encoded dashes so the month is still found', () => {
    expect(byId('MTI3Mzc=')?.title).toContain('January– 2025')
    expect(byId('MTI3Mzc=')?.noticeYm).toBe(202501)
  })

  it('falls back to the release month when the title names none', () => {
    expect(byId('MTE5NTU=')).toMatchObject({ title: 'Samples declared NSQ 2017-2023', noticeYm: 202409 })
  })
})

describe('guessTemplate', () => {
  it.each([
    ['NSQ ALERT FOR THE MONTH OF MAY-2025', '2025-06-20', 'cdsco-modern'],
    ['State Drug Alert for the Month of December 2024', '2025-01-24', 'cdsco-state'],
    ['SPURIOUS ALERT FOR THE MONTH OF APRIL 2024', '2024-05-17', 'cdsco-spurious'],
    ['List of Drugs ... declared as Not of Standard Quality/Spurious/Adulterated', '2025-05-20', 'cdsco-modern'],
    ['Drug Alert list for month of June 2017', '2017-07-05', 'cdsco-legacy'],
  ] as const)('%s → %s', (title, date, expected) => {
    expect(guessTemplate(title, date)).toBe(expected)
  })
})

describe('iframeTarget', () => {
  it('encodes spaces in the PDF path', () => {
    const html = "<iframe src='/opencms/resources/UploadCDSCOWeb/2018/UploadAlertsFiles/CDSCO NSQ june25.pdf' width='100%' height='100%' target='_blank'></iframe>"
    expect(iframeTarget(html)).toBe('https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadAlertsFiles/CDSCO%20NSQ%20june25.pdf')
  })
  it('does not double-encode', () => {
    expect(iframeTarget("<iframe src='/a/CDSCO%20NSQ.pdf'></iframe>")).toBe('https://cdsco.gov.in/a/CDSCO%20NSQ.pdf')
  })
  it('returns null without an iframe', () => {
    expect(iframeTarget('<html><body>Error</body></html>')).toBeNull()
  })
})

describe('cdscoPdf.discover', () => {
  it('resolves each download page to the final PDF URL, newest first', async () => {
    const { http, calls } = fakeHttp((url) => {
      if (url === LISTING_URL) return { body: listing }
      if (url.startsWith(DL)) {
        const id = new URL(url).searchParams.get('num_id')
        return { body: `<iframe src='/opencms/resources/UploadCDSCOWeb/2018/UploadAlertsFiles/file ${id}.pdf'></iframe>` }
      }
      return undefined
    })
    const docs = await cdscoPdf.discover({ http, limit: 3, sinceYm: 202505 })
    expect(docs).toHaveLength(3)
    expect(docs[0]).toMatchObject({
      sourceId: 'cdsco-pdf',
      authority: 'CDSCO',
      jurisdiction: 'IN',
      url: 'https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadAlertsFiles/file%20MTI5Mjc=.pdf',
      title: 'CDSCO NSQ ALERT FOR THE MONTH OF June 2025',
      publishedAt: '2025-07-18',
      noticeYm: 202506,
      kind: 'pdf',
      hints: { template: 'cdsco-modern', numId: 'MTI5Mjc=' },
    })
    expect(docs.map((d) => d.hints.template)).toEqual(['cdsco-modern', 'cdsco-spurious', 'cdsco-state'])
    expect(calls.filter((c) => c.url.startsWith(DL))).toHaveLength(3)
  })

  it('skips a notice whose download page is gone but keeps the rest', async () => {
    const { http } = fakeHttp((url) => {
      if (url === LISTING_URL) return { body: listing }
      if (url === `${DL}MTI5Mjc=`) return { status: 404, body: 'gone' }
      if (url.startsWith(DL)) return { body: "<iframe src='/x/a.pdf'></iframe>" }
      return undefined
    })
    const docs = await cdscoPdf.discover({ http, limit: 2 })
    expect(docs).toHaveLength(1)
    expect(docs[0]!.hints.numId).toBe('MTI5NTk=')
  })
})
