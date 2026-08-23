declare function qrcode(typeNumber: number, errorCorrectionLevel: string): QRCode

interface QRCode {
  addData(data: string, mode?: string): void
  make(): void
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}

export = qrcode
