import iconv from 'iconv-lite'

export const encodeText = (text: string): Buffer => {
	// Remove all characters that are not letters, numbers, punctuation or whitespace printers cannot handle emojis
	const filtered = text.replaceAll(/[^\p{L}\p{N}\p{P}\p{Z}\n\r×]+/gu, '')
	return iconv.encode(filtered, 'CP852')
}
