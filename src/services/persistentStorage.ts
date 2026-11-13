const DB_NAME = 'wechat-sticker-studio-state'
const STORE_NAME = 'snapshots'
const DB_VERSION = 1

let databasePromise: Promise<IDBDatabase> | undefined

function openDatabase() {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开本地持久化存储'))
  })
  return databasePromise
}

export async function readPersistentState<T>(key: string): Promise<T | undefined> {
  try {
    const db = await openDatabase()
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error || new Error('读取本地状态失败'))
    })
  } catch {
    return undefined
  }
}

export async function writePersistentState<T>(key: string, value: T): Promise<boolean> {
  try {
    const db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error || new Error('保存本地状态失败'))
    })
    return true
  } catch {
    return false
  }
}
