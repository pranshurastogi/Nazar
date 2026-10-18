'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import {
  Camera,
  CameraOff,
  ImageUp,
  Keyboard,
  LoaderCircle,
  Lock,
  ShieldAlert,
  SwitchCamera,
  X,
  Zap,
  ZapOff,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SentinelEye } from '@/components/ui/sentinel-core'
import { Rings } from '@/components/nazar/rings'
import { decodeFrame, decodePhoto, warmDecoders } from '@/lib/scan/decode'
import { confidenceOf, prepareForOcr, recognize, recognizeLabel, releaseOcrSoon, warmOcr } from '@/lib/scan/ocr'
import { packSummary, type PackLabel } from '@/lib/scan/pack'
import { bestCodeRead as bestRead } from '@/lib/scan/photo'
import { interpretOcr, readPack, readsDisagree, Vote, withCodeName, type ScanRead } from '@/lib/scan/read'
import { useT, type MessageKey, type Vars } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { moreIn, ScanResult, type Found } from './scan-result'
import { ViewfinderOverlay, cropFor } from './viewfinder'

type Blocked = 'denied' | 'nocamera' | 'busy' | 'insecure' | 'unsupported'
type Phase =
  | { kind: 'idle' }
  | { kind: 'prompt' }
  | { kind: 'starting' }
  | { kind: 'live' }
  | { kind: 'blocked'; reason: Blocked }
  | { kind: 'photo' }
  | { kind: 'empty'; note: MessageKey; pack?: PackLabel | null }
  | { kind: 'result'; found: Found }

/** Codes are error-corrected, so two identical frames settle it; printed text needs 3 of the last 5. */
const CODE_VOTES = 2
const TEXT_VOTES = 3
/** Look for a code this long before also reading printed text. */
const OCR_AFTER_MS = 3000
const FRAME_GAP_MS = 160
const FRAME_MAX_W = 1280
const CROSS_CHECK_MS = 12_000

const SOURCE_TEXT = { qr: 'scan.src.qr', datamatrix: 'scan.src.datamatrix', barcode: 'scan.src.barcode', text: 'scan.src.text' } as const satisfies Record<string, MessageKey>

/**
 * A message kept as a key, not as text, so the status line and the screen-reader announcement follow
 * a language switch mid-scan. `keys` are placeholders that are themselves translated (a source, a note).
 */
type Msg = { key: MessageKey; vars?: Vars; keys?: Record<string, MessageKey> } | null
const msg = (key: MessageKey, vars?: Vars, keys?: Record<string, MessageKey>): Msg => ({ key, vars, keys })

function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const scale = Math.min(1, FRAME_MAX_W / video.videoWidth)
  canvas.width = Math.round(video.videoWidth * scale)
  canvas.height = Math.round(video.videoHeight * scale)
  canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, 0, 0, canvas.width, canvas.height)
}

function blockedOf(err: unknown): Blocked {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied'
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'busy'
  return 'nocamera'
}

export function Scanner({
  open,
  onOpenChange,
  onCheck,
  onType,
  typeTarget,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs the normal batch check (with the label read, when there is one). The scanner closes first. */
  onCheck: (batch: string, pack?: PackLabel) => void
  /** "Type it instead": close and hand focus to the batch input. */
  onType: () => void
  typeTarget?: React.RefObject<HTMLElement | null>
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const { t, tr } = useT()
  const [status, setStatus] = useState<Msg>(null)
  const [announce, setAnnounce] = useState<Msg>(null)
  const say = (m: Msg) => {
    if (!m) return ''
    const keyed = Object.fromEntries(Object.entries(m.keys ?? {}).map(([k, v]) => [k, t(v)]))
    return t(m.key, { ...m.vars, ...keyed })
  }
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false })
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])

  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const loopRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped on every start, stop and close, so late async results from an old session are ignored. */
  const genRef = useRef(0)
  const typingRef = useRef(false)
  const phaseRef = useRef<Phase['kind']>('idle')
  phaseRef.current = phase.kind

  const stopCamera = useCallback(() => {
    if (loopRef.current) clearTimeout(loopRef.current)
    loopRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setTorch({ available: false, on: false })
  }, [])

  const finishRead = useCallback(
    (found: Found) => {
      stopCamera()
      setPhase({ kind: 'result', found })
      setAnnounce(
        found.mismatch
          ? msg('scan.mismatch')
          : found.batch
            ? msg('scan.announce.read', { batch: found.batch }, { source: SOURCE_TEXT[found.source] })
            : msg('scan.announce.noBatch'),
      )
    },
    [stopCamera],
  )

  /**
   * Reads the whole printed label in the background: product, composition, maker and the rest. After a
   * code read it is also a second opinion, raising a mismatch when the printed batch differs from the code's.
   */
  const crossCheck = useCallback((canvas: HTMLCanvasElement, codeBatch: string | null, gen: number) => {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), CROSS_CHECK_MS))
    Promise.race([recognizeLabel(canvas).then((r) => ({ printed: interpretOcr(r.text), pack: readPack(r) })), timeout])
      .catch(() => null)
      .then((read) => {
        if (gen !== genRef.current) return
        setPhase((p) => {
          if (p.kind !== 'result') return p
          const printed = read?.printed
          const mismatch = codeBatch && printed?.batch && readsDisagree(codeBatch, printed.batch) ? { code: codeBatch, printed: printed.batch } : undefined
          if (mismatch) setAnnounce(msg('scan.mismatch'))
          const pack = withCodeName(read?.pack ?? p.found.pack, p.found.codeName) ?? undefined
          return { kind: 'result', found: { ...p.found, crossCheck: codeBatch ? 'done' : p.found.crossCheck, mismatch, pack, packPending: false } }
        })
      })
  }, [])

  const runLoop = useCallback(
    (gen: number) => {
      const video = videoRef.current
      if (!video) return
      const frame = document.createElement('canvas')
      const codeVote = new Vote(5)
      const textVote = new Vote(5)
      const textConf = new Map<string, number>()
      let codeMeta: ScanRead | null = null
      let ocrBusy = false
      const started = performance.now()
      setStatus(msg('scan.status.looking'))

      const tick = async () => {
        if (gen !== genRef.current) return
        if (video.readyState >= 2 && video.videoWidth) {
          drawFrame(video, frame)
          try {
            const read = bestRead(await decodeFrame(frame))
            if (gen !== genRef.current) return
            if (read?.batch) {
              codeVote.push(read.batch)
              codeMeta = read
              const lead = codeVote.leader()!
              if (lead.votes >= CODE_VOTES) {
                const snapshot = prepareForOcr(video, video.videoWidth, video.videoHeight, undefined, 1800)
                finishRead({
                  batch: lead.batch,
                  source: read.source,
                  kind: read.kind,
                  expiry: read.expiry,
                  mfg: read.mfg,
                  gtin: read.gtin,
                  codeName: read.name,
                  votes: { votes: lead.votes, of: codeVote.count },
                  crossCheck: 'pending',
                  packPending: true,
                })
                crossCheck(snapshot, lead.batch, gen)
                return
              }
              setStatus(msg('scan.status.seen', { batch: lead.batch }))
            } else if (read && !read.batch) {
              codeMeta = read
              setStatus(msg('scan.status.productCode'))
            }
          } catch {}

          if (!ocrBusy && performance.now() - started > OCR_AFTER_MS) {
            ocrBusy = true
            if (!codeMeta) setStatus(msg('scan.status.noCode'))
            const crop = prepareForOcr(video, video.videoWidth, video.videoHeight, cropFor(video))
            recognize(crop, 'block')
              .then((r) => {
                if (gen !== genRef.current) return
                const read = interpretOcr(r.text)
                if (!read?.batch) return
                textVote.push(read.batch)
                textConf.set(read.batch, confidenceOf(r, read.batch))
                const lead = textVote.leader()!
                if (lead.votes >= TEXT_VOTES) {
                  const still = prepareForOcr(video, video.videoWidth, video.videoHeight, undefined, 1800)
                  finishRead({
                    batch: lead.batch,
                    source: 'text',
                    kind: 'ocr',
                    expiry: read.expiry ?? codeMeta?.expiry,
                    mfg: read.mfg ?? codeMeta?.mfg,
                    gtin: codeMeta?.gtin,
                    codeName: codeMeta?.name,
                    votes: { votes: lead.votes, of: textVote.count },
                    confidence: textConf.get(lead.batch),
                    crossCheck: 'none',
                    packPending: true,
                  })
                  crossCheck(still, null, gen)
                } else setStatus(msg('scan.status.reading', { batch: lead.batch, n: lead.votes, total: TEXT_VOTES }))
              })
              .catch(() => gen === genRef.current && setStatus(msg('scan.status.ocrDown')))
              .finally(() => (ocrBusy = false))
          }
        }
        if (gen === genRef.current) loopRef.current = setTimeout(tick, FRAME_GAP_MS)
      }
      loopRef.current = setTimeout(tick, FRAME_GAP_MS)
    },
    [crossCheck, finishRead],
  )

  const startCamera = useCallback(
    async (deviceId?: string) => {
      stopCamera()
      const gen = ++genRef.current
      if (!window.isSecureContext) return setPhase({ kind: 'blocked', reason: 'insecure' })
      if (!navigator.mediaDevices?.getUserMedia) return setPhase({ kind: 'blocked', reason: 'unsupported' })
      setPhase({ kind: 'starting' })
      warmDecoders()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        if (gen !== genRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const track = stream.getVideoTracks()[0]
        const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean }
        setTorch({ available: !!caps.torch, on: false })
        setPhase({ kind: 'live' })
        // The video element mounts with the live phase; attach on the next frame.
        requestAnimationFrame(async () => {
          const video = videoRef.current
          if (!video || gen !== genRef.current) return
          video.srcObject = stream
          await video.play().catch(() => {})
          runLoop(gen)
        })
        navigator.mediaDevices
          .enumerateDevices()
          .then((d) => gen === genRef.current && setCameras(d.filter((x) => x.kind === 'videoinput')))
          .catch(() => {})
        setTimeout(() => gen === genRef.current && warmOcr(), OCR_AFTER_MS / 2)
      } catch (err) {
        if (gen !== genRef.current) return
        setPhase({ kind: 'blocked', reason: blockedOf(err) })
      }
    },
    [runLoop, stopCamera],
  )

  // Open: start straight away if the camera is already allowed, otherwise explain before the browser asks.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    typingRef.current = false
    setAnnounce(null)
    ;(async () => {
      if (!window.isSecureContext) return setPhase({ kind: 'blocked', reason: 'insecure' })
      if (!navigator.mediaDevices?.getUserMedia) return setPhase({ kind: 'blocked', reason: 'unsupported' })
      const state = await navigator.permissions
        ?.query({ name: 'camera' as PermissionName })
        .then((s) => s.state)
        .catch(() => null)
      if (cancelled) return
      if (state === 'granted') startCamera()
      else if (state === 'denied') setPhase({ kind: 'blocked', reason: 'denied' })
      else setPhase({ kind: 'prompt' })
    })()
    return () => {
      cancelled = true
      genRef.current++
      stopCamera()
      setPhase({ kind: 'idle' })
      setStatus(null)
      releaseOcrSoon()
    }
  }, [open, startCamera, stopCamera])

  // Never keep the camera on in a background tab; resume when the person comes back.
  useEffect(() => {
    if (!open) return
    const onVis = () => {
      if (document.hidden && streamRef.current) {
        genRef.current++
        stopCamera()
      } else if (!document.hidden && !streamRef.current && (phaseRef.current === 'live' || phaseRef.current === 'starting')) {
        startCamera()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [open, startCamera, stopCamera])

  useEffect(() => () => stopCamera(), [stopCamera])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const on = !torch.on
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setTorch({ available: true, on })
    } catch {
      setTorch({ available: false, on: false })
    }
  }

  const switchCamera = () => {
    const current = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId
    const i = cameras.findIndex((c) => c.deviceId === current)
    const next = cameras[(i + 1) % cameras.length]
    if (next) startCamera(next.deviceId)
  }

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    stopCamera()
    const gen = ++genRef.current
    setPhase({ kind: 'photo' })
    setAnnounce(msg('scan.announce.photo'))
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const code = bestRead(await decodePhoto(canvas, file))
      if (gen !== genRef.current) return
      const ocrInput = prepareForOcr(canvas, canvas.width, canvas.height, undefined, 2000)
      if (code?.batch) {
        finishRead({ batch: code.batch, source: code.source, kind: code.kind, expiry: code.expiry, mfg: code.mfg, gtin: code.gtin, codeName: code.name, crossCheck: 'pending', packPending: true })
        crossCheck(ocrInput, code.batch, gen)
        return
      }
      setAnnounce(msg('scan.announce.photoText'))
      const r = await recognizeLabel(ocrInput, { tryHarder: true })
      if (gen !== genRef.current) return
      const text = interpretOcr(r.text)
      const pack = withCodeName(readPack(r), code?.name) ?? undefined
      if (text?.batch) {
        finishRead({
          batch: text.batch,
          source: 'text',
          kind: 'ocr',
          expiry: text.expiry ?? code?.expiry,
          mfg: text.mfg ?? code?.mfg,
          gtin: code?.gtin,
          codeName: code?.name,
          confidence: confidenceOf(r, text.batch),
          crossCheck: 'none',
          pack,
        })
        return
      }
      const note: MessageKey = code?.gtin ? 'scan.note.productCode' : 'scan.note.noBatch'
      const named = packSummary(pack).name
      setPhase({ kind: 'empty', note, pack })
      setAnnounce(named ? msg('scan.announce.named', { name: named }, { note }) : msg(note))
    } catch {
      if (gen !== genRef.current) return
      setPhase({ kind: 'empty', note: 'scan.note.unreadable' })
      setAnnounce(msg('scan.note.unreadable'))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const typeInstead = () => {
    typingRef.current = true
    onType()
  }

  const live = phase.kind === 'live' || phase.kind === 'starting'

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 duration-150 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          data-scanner
          data-phase={phase.kind}
          finalFocus={() => (typingRef.current && typeTarget?.current) || true}
          className={cn(
            'fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-background text-foreground outline-none',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[min(34rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:shadow-2xl',
            'duration-150 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0 sm:data-open:slide-in-from-bottom-0 sm:data-open:zoom-in-95',
          )}
        >
          <header className="flex items-start gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 sm:px-5 sm:pt-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">{t('scan.title')}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-sm text-muted-foreground">
                {tr('scan.desc', { code: <span className="font-mono">B.No.</span> })}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close render={<Button variant="ghost" className="-mr-2 size-12 rounded-full" aria-label={t('scan.close')} />}>
              <X className="size-5" />
            </DialogPrimitive.Close>
          </header>

          <div className="flex flex-1 flex-col px-4 sm:px-5">
            {live && (
              <div className="relative isolate flex-1 overflow-hidden rounded-2xl bg-black sm:aspect-[4/3] sm:flex-none min-h-[22rem] sm:min-h-0">
                <video ref={videoRef} data-scan-video playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
                <ViewfinderOverlay active={phase.kind === 'live'} />
                {phase.kind === 'live' && (
                  <span className="absolute top-3 left-3 inline-flex h-12 items-center gap-2 rounded-full bg-black/55 pr-3.5 pl-2 text-xs font-semibold text-white backdrop-blur-sm" data-scan-eye>
                    <SentinelEye state="scanning" follow={false} className="w-11" />
                    {t('scan.looking')}
                  </span>
                )}
                <div className="absolute top-3 right-3 flex gap-2">
                  {torch.available && (
                    <Button
                      variant="ghost"
                      onClick={toggleTorch}
                      aria-pressed={torch.on}
                      aria-label={torch.on ? t('scan.torchOff') : t('scan.torchOn')}
                      className="size-12 rounded-full bg-black/55 text-white hover:bg-black/70 hover:text-white"
                    >
                      {torch.on ? <ZapOff className="size-5" /> : <Zap className="size-5" />}
                    </Button>
                  )}
                  {cameras.length > 1 && (
                    <Button variant="ghost" onClick={switchCamera} aria-label={t('scan.switchCamera')} className="size-12 rounded-full bg-black/55 text-white hover:bg-black/70 hover:text-white">
                      <SwitchCamera className="size-5" />
                    </Button>
                  )}
                </div>
                <p className="absolute inset-x-3 bottom-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-black/60 px-3 py-2 text-center text-sm font-medium text-white backdrop-blur-sm" role="status">
                  {phase.kind === 'starting' ? (
                    <>
                      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> {t('scan.starting')}
                    </>
                  ) : (
                    say(status)
                  )}
                </p>
              </div>
            )}

            {phase.kind === 'prompt' && (
              <StatePanel art={<SentinelEye className="w-40" />} title={t('scan.promptTitle')}>
                <p>{t('scan.promptBody')}</p>
                <Button className="mt-5 h-12 w-full rounded-xl text-base font-semibold sm:w-auto sm:px-6" onClick={() => startCamera()}>
                  <Camera data-icon="inline-start" /> {t('scan.useCamera')}
                </Button>
              </StatePanel>
            )}

            {phase.kind === 'blocked' && <BlockedPanel reason={phase.reason} onRetry={() => startCamera()} />}

            {phase.kind === 'photo' && (
              <StatePanel art={<SentinelEye state="scanning" follow={false} className="w-40" />} title={t('scan.photoTitle')} busy>
                <p>{t('scan.photoBody')}</p>
              </StatePanel>
            )}

            {phase.kind === 'empty' && (
              <StatePanel icon={<ShieldAlert />} title={t('scan.emptyTitle')} tone="caution">
                <EmptyName pack={phase.pack} />
                <p>{t('scan.emptyBody', { note: t(phase.note) })}</p>
                <Button variant="outline" className="mt-5 h-12 rounded-xl px-5" onClick={() => startCamera()}>
                  <Camera data-icon="inline-start" /> {t('scan.tryCameraAgain')}
                </Button>
              </StatePanel>
            )}

            {phase.kind === 'result' && (
              <ScanResult
                found={phase.found}
                onCheck={(b, pack) => {
                  onCheck(b, pack)
                }}
                onRescan={() => startCamera()}
              />
            )}
          </div>

          <footer className="mt-auto grid gap-2 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
              <Button variant="outline" className="h-12 rounded-xl text-sm font-semibold" onClick={() => fileRef.current?.click()}>
                <ImageUp data-icon="inline-start" /> {t('scan.upload')}
              </Button>
              <Button variant="outline" className="h-12 rounded-xl text-sm font-semibold" onClick={typeInstead}>
                <Keyboard data-icon="inline-start" /> {t('scan.typeInstead')}
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-scan-upload
              onChange={(e) => onPhoto(e.target.files?.[0])}
            />
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <Lock className="size-3.5 shrink-0" /> {t('scan.privacy')}
            </p>
          </footer>
          <p className="sr-only" aria-live="polite" aria-atomic="true" data-scan-announce>
            {say(announce)}
          </p>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function StatePanel({
  icon,
  art,
  title,
  tone,
  busy,
  children,
}: {
  icon?: React.ReactNode
  /** Replaces the ringed icon with a larger illustration (the sentinel eye). */
  art?: React.ReactNode
  title: string
  tone?: 'caution'
  busy?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border bg-card px-5 py-8 text-center sm:py-10" aria-busy={busy || undefined}>
      {art ?? <Rings className={cn('size-28', tone === 'caution' && '[&_svg]:text-caution [&>div]:text-caution')}>{icon}</Rings>}
      <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
      <div className="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">{children}</div>
    </div>
  )
}

/** The medicine name read from a photo that had no batch number: the name still helps the person. */
function EmptyName({ pack }: { pack?: PackLabel | null }) {
  const { tr, locale } = useT()
  const { name, detail: read } = packSummary(pack)
  const detail = moreIn(locale, read)
  if (!name) return null
  return (
    <p className="mb-2 text-foreground" data-scan-empty-name>
      {tr('scan.emptyName', { name: <span className="font-semibold">{name}</span> })}
      {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
    </p>
  )
}

function blockedCopy(reason: Blocked, t: ReturnType<typeof useT>['t'], tr: ReturnType<typeof useT>['tr']): { title: string; body: React.ReactNode; retry?: boolean } {
  switch (reason) {
    case 'denied':
      return {
        title: t('scan.blocked.denied.title'),
        body: (
          <>
            <p>{t('scan.blocked.denied.lead')}</p>
            <ul className="mt-3 grid gap-1.5 text-left">
              <li><span className="font-semibold text-foreground">{t('scan.blocked.chrome')}</span>{t('scan.blocked.chromeSteps')}</li>
              <li><span className="font-semibold text-foreground">{t('scan.blocked.safari')}</span>{tr('scan.blocked.safariSteps', { code: <span className="font-mono">aA</span> })}</li>
              <li><span className="font-semibold text-foreground">{t('scan.blocked.desktop')}</span>{t('scan.blocked.desktopSteps')}</li>
            </ul>
          </>
        ),
        retry: true,
      }
    case 'nocamera':
      return { title: t('scan.blocked.nocamera.title'), body: <p>{t('scan.blocked.nocamera.body')}</p>, retry: true }
    case 'busy':
      return { title: t('scan.blocked.busy.title'), body: <p>{t('scan.blocked.busy.body')}</p>, retry: true }
    case 'insecure':
      return {
        title: t('scan.blocked.insecure.title'),
        body: <p>{tr('scan.blocked.insecure.body', { https: <span className="font-mono">https://</span> })}</p>,
      }
    case 'unsupported':
      return { title: t('scan.blocked.unsupported.title'), body: <p>{t('scan.blocked.unsupported.body')}</p> }
  }
}

function BlockedPanel({ reason, onRetry }: { reason: Blocked; onRetry: () => void }) {
  const { t, tr } = useT()
  const b = blockedCopy(reason, t, tr)
  return (
    <div data-blocked={reason} className="flex flex-1 flex-col">
      <StatePanel icon={<CameraOff />} title={b.title} tone="caution">
        {b.body}
        {b.retry && (
          <Button variant="outline" className="mt-5 h-12 rounded-xl px-5" onClick={onRetry}>
            <Camera data-icon="inline-start" /> {t('scan.tryAgain')}
          </Button>
        )}
      </StatePanel>
    </div>
  )
}
