import qrcode = require('../vendor/qrcode')

export function drawQrCode(canvas: any, token: string): void {
  const qr = qrcode(0, 'M')
  qr.addData(token)
  qr.make()
  const count = qr.getModuleCount()
  const size = 300
  const margin = 10
  const scale = (size - margin * 2) / count
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, size, size)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#000000'
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(margin + c * scale, margin + r * scale, Math.ceil(scale), Math.ceil(scale))
      }
    }
  }
}
