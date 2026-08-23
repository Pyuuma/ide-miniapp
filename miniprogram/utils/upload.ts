export function uploadImage(dir: string, filePath: string): Promise<string> {
  const extMatch = /\.(\w+)$/.exec(filePath)
  const ext = extMatch ? extMatch[1] : 'png'
  const cloudPath = `${dir}/${Date.now()}_${Math.floor(Math.random() * 1e6)}.${ext}`
  return wx.cloud
    .uploadFile({ cloudPath, filePath })
    .then(res => res.fileID)
}

export function uploadImages(dir: string, filePaths: string[]): Promise<string[]> {
  return Promise.all(filePaths.map(path => uploadImage(dir, path)))
}
