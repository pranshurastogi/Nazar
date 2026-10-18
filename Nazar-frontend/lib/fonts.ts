import { Instrument_Serif } from 'next/font/google'

/**
 * The editorial accent face: italic Instrument Serif, used for one emphasised phrase in a page's
 * headline (the Arkiv hero, How it works, Feed and Cabinet heroes). Body and UI stay Noto Sans.
 * Loaded once here so every page shares the same self-hosted file.
 */
export const serif = Instrument_Serif({ weight: '400', style: ['italic'], subsets: ['latin'], display: 'swap', variable: '--font-serif' })
