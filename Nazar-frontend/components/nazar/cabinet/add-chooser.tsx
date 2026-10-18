'use client'

import { useRef } from 'react'
import { Camera, ChevronRight, ImageUp, Keyboard, Lock } from 'lucide-react'

import { warmPhotoReader } from '@/lib/scan/photo'
import { cn } from '@/lib/utils'

// The first step of "Add a medicine": three ways in. A photo of the pack is the quick one, so it
// leads; on a phone "Take a photo" opens the rear camera, "Upload a photo" opens the gallery.

const tile =
  'group flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border bg-card px-3.5 py-3 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 active:translate-y-px'

export function AddChooser({ onPhoto, onType }: { onPhoto: (file: File) => void; onType: () => void }) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const take = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onPhoto(file)
  }

  return (
    <div className="grid gap-2.5 px-5 pt-3 pb-5" data-cabinet-choose>
      <button
        type="button"
        className={cn(
          'group flex min-h-[5.5rem] w-full items-center gap-3.5 rounded-2xl bg-primary px-4 py-3.5 text-left text-primary-foreground transition-colors outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-popover active:translate-y-px',
        )}
        onPointerDown={warmPhotoReader}
        onFocus={warmPhotoReader}
        onClick={() => cameraRef.current?.click()}
        data-add-camera-btn
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary-foreground/15">
          <Camera className="size-6" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base leading-snug font-semibold">Take a photo of the pack</span>
          <span className="mt-0.5 block text-[13px] leading-5 text-pretty text-primary-foreground/80">Nazar reads the name, batch and expiry for you</span>
        </span>
        <ChevronRight className="size-5 shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
      </button>

      <div className="grid grid-cols-1 gap-2.5 min-[340px]:grid-cols-2">
        <button type="button" className={tile} onPointerDown={warmPhotoReader} onClick={() => uploadRef.current?.click()} data-add-upload-btn>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <ImageUp className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 text-sm leading-snug font-semibold">Upload a photo</span>
        </button>
        <button type="button" className={tile} onClick={onType} data-add-type>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Keyboard className="size-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 text-sm leading-snug font-semibold">Type it in</span>
        </button>
      </div>

      <p className="mt-1 flex items-start justify-center gap-1.5 text-center text-xs leading-5 text-muted-foreground" data-add-privacy>
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>Photos are read on this device and never uploaded.</span>
      </p>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-add-camera onChange={take} />
      <input ref={uploadRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" data-add-upload onChange={take} />
    </div>
  )
}
