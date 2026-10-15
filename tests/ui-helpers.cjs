const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function runtime(api = {}, overrides = {}) {
  const calls = []
  const storage = new Map()
  const wx = {
    getStorageSync: key => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key),
    showToast: data => calls.push(['toast', data]),
    showModal: data => calls.push(['modal', data]),
    showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
    navigateTo: data => calls.push(['navigate', data]),
    navigateBack: data => calls.push(['back', data]),
    reLaunch: data => calls.push(['relaunch', data]),
    enableAlertBeforeUnload: data => calls.push(['enableUnloadAlert', data]),
    disableAlertBeforeUnload: data => calls.push(['disableUnloadAlert', data]),
    ...overrides,
  }
  const cache = new Map()
  const mocks = new Map([[path.join(root, 'miniprogram/utils/api.ts'), { api }]])
  let page
  function load(relative, useRealApi = false) {
    const filename = path.isAbsolute(relative) ? relative : path.join(root, relative)
    if (!useRealApi && mocks.has(filename)) return mocks.get(filename)
    if (cache.has(filename)) return cache.get(filename)
    const module = { exports: {} }
    cache.set(filename, module.exports)
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    const context = {
      module, exports: module.exports, wx, console,
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      Page: definition => { page = definition },
      getCurrentPages: () => [],
      require: specifier => {
        if (!specifier.startsWith('.')) return require(specifier)
        let resolved = path.resolve(path.dirname(filename), specifier)
        if (!path.extname(resolved)) resolved += '.ts'
        return load(resolved)
      },
    }
    vm.runInNewContext(source, context, { filename })
    cache.set(filename, module.exports)
    return module.exports
  }
  function loadPage(relative) {
    load(relative)
    const result = page
    result.data = structuredClone(result.data)
    result.getTabBar = () => null
    result.setData = function(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        const fields = key.replace(/\[(\d+)\]/g, '.$1').split('.')
        let target = this.data
        for (const field of fields.slice(0, -1)) target = target[field] ||= {}
        target[fields.at(-1)] = value
      }
      callback?.()
    }
    return result
  }
  return { wx, storage, calls, load, loadPage }
}

const tick = () => new Promise(resolve => setImmediate(resolve))
module.exports = { runtime, deferred, tick }
