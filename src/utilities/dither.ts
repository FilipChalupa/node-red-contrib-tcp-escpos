import { Canvas } from 'skia-canvas'

export const dither = (canvas: Canvas) => {
	const context = canvas.getContext('2d')
	if (!context) {
		throw new Error('Context not available.')
	}
	const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
	const { data } = imageData
	const dataLength = data.length
	const w = canvas.width
	const lumR: Array<number> = []
	const lumG: Array<number> = []
	const lumB: Array<number> = []

	let newPixel: number
	let err: number

	for (let i = 0; i < 256; i++) {
		lumR[i] = i * 0.299
		lumG[i] = i * 0.587
		lumB[i] = i * 0.11
	}

	// Greyscale luminance (sets r pixels to luminance of rgb)
	for (let i = 0; i <= dataLength; i += 4) {
		data[i] = Math.floor(lumR[data[i]] + lumG[data[i + 1]] + lumB[data[i + 2]])
	}

	for (let currentPixel = 0; currentPixel <= dataLength; currentPixel += 4) {
		// threshold for determining current pixel's conversion to a black or white pixel
		newPixel = data[currentPixel] < 150 ? 0 : 255
		err = Math.floor((data[currentPixel] - newPixel) / 23)
		data[currentPixel + 0 * 1 - 0] = newPixel
		data[currentPixel + 4 * 1 - 0] += err * 7
		data[currentPixel + 4 * w - 4] += err * 3
		data[currentPixel + 4 * w - 0] += err * 5
		data[currentPixel + 4 * w + 4] += err * 1
		// Set g and b values equal to r (effectively greyscales the image fully)
		data[currentPixel + 1] = data[currentPixel + 2] = data[currentPixel]
	}
	context.putImageData(imageData, 0, 0)
}
