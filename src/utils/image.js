/**
 * Shop logos are stored as data URLs inside the shop document rather than in
 * Cloud Storage — Storage needs a billing-enabled project, and a logo shrunk to
 * 256px is a few KB, comfortably inside Firestore's 1MB document limit.
 */

const MAX_EDGE = 256
const MAX_BYTES = 180 * 1024

export function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Choose an image file (PNG, JPG or SVG).'))
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const src = String(reader.result)

      // SVG is already tiny and scales perfectly — keep it as-is.
      if (file.type === 'image/svg+xml') {
        if (src.length > MAX_BYTES) reject(new Error('That SVG is too large. Use one under 180KB.'))
        else resolve(src)
        return
      }

      const img = new Image()
      img.onerror = () => reject(new Error('That image could not be decoded.'))
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)

        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        // PNG keeps transparency; anything else compresses better as JPEG.
        const out = file.type === 'image/png'
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.85)

        if (out.length > MAX_BYTES) {
          resolve(canvas.toDataURL('image/jpeg', 0.6))
        } else {
          resolve(out)
        }
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}
