// 矩阵压缩存储：索引只留"排名"（6 字节/条），载荷整体 brotli 压缩，
// 用时按需解压 + 解析单条（展开）。
//
// 文件布局：
//   <base>.idx   magic(4) + count(4) + count × rank(6B)
//   <base>.dat   brotli( JSONL：每行 [key, payload] )
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import { capacityOf } from './perm-memory.js'

const MAGIC = 'DFYM'
const RANK_BYTES = 6

function hashKey(key) {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const value = String(key)
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0
    h2 = Math.imul(h2 + code, 2654435761) >>> 0
  }
  return Math.abs(h1 * 4294967296 + h2)
}

export class MatrixStore {
  constructor({ base = './matrix-store', order = 17 } = {}) {
    this.base = base
    this.order = order
    this.capacity = capacityOf(order)
    this.rows = []            // { key, rank, payload }
    this.lookup = new Map()   // key -> row
    this._blob = null
  }

  get idxPath() { return `${this.base}.idx` }
  get datPath() { return `${this.base}.dat` }

  put(key, payload) {
    const id = String(key)
    const existing = this.lookup.get(id)
    if (existing) {
      existing.payload = payload
      this._blob = null
      return existing
    }
    const rank = hashKey(id) % this.capacity
    const row = { key: id, rank, payload }
    this.rows.push(row)
    this.lookup.set(id, row)
    this._blob = null
    return row
  }

  get(key) {
    const row = this.lookup.get(String(key))
    return row ? row.payload : null
  }

  // 只返回排名（不展开载荷）
  address(key) {
    const row = this.lookup.get(String(key))
    if (row) return row.rank
    return hashKey(String(key)) % this.capacity
  }

  // 从排名反查（展开时才扫描排名）
  keyAtRank(rank) {
    return this.rows.find((row) => row.rank === rank)?.key ?? null
  }

  _encode() {
    return Buffer.from(this.rows.map((row) => JSON.stringify([row.key, row.payload])).join('\n'), 'utf8')
  }

  save() {
    mkdirSync(dirname(this.idxPath), { recursive: true })
    const payload = this._encode()
    const compressed = brotliCompressSync(payload, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
    const index = Buffer.alloc(8 + this.rows.length * RANK_BYTES)
    index.write(MAGIC, 0, 'ascii')
    index.writeUInt32LE(this.rows.length, 4)
    this.rows.forEach((row, i) => {
      let rank = BigInt(row.rank)
      const base = 8 + i * RANK_BYTES
      for (let b = RANK_BYTES - 1; b >= 0; b -= 1) { index[base + b] = Number(rank & 0xffn); rank >>= 8n }
    })
    writeFileSync(this.idxPath, index)
    writeFileSync(this.datPath, compressed)
    this._blob = null
    return this.stats(payload.length, compressed.length)
  }

  load() {
    if (!existsSync(this.idxPath) || !existsSync(this.datPath)) return false
    const index = readFileSync(this.idxPath)
    if (index.subarray(0, 4).toString() !== MAGIC) return false
    const count = index.readUInt32LE(4)
    const compressed = readFileSync(this.datPath)
    const payload = brotliDecompressSync(compressed)
    const lines = payload.toString('utf8').split('\n').filter(Boolean)
    this.rows = []
    this.lookup = new Map()
    for (let i = 0; i < Math.min(count, lines.length); i += 1) {
      const [key, value] = JSON.parse(lines[i])
      let rank = 0n
      const base = 8 + i * RANK_BYTES
      for (let b = 0; b < RANK_BYTES; b += 1) rank = (rank << 8n) | BigInt(index[base + b])
      const row = { key, rank: Number(rank), payload: value }
      this.rows.push(row)
      this.lookup.set(key, row)
    }
    return true
  }

  stats(payloadBytes, compressedBytes) {
    const raw = payloadBytes ?? this._encode().length
    const packed = compressedBytes ?? brotliCompressSync(this._encode()).length
    const indexBytes = 8 + this.rows.length * RANK_BYTES
    return {
      entries: this.rows.length,
      payloadBytes: raw,
      compressedBytes: packed,
      indexBytes,
      totalBytes: indexBytes + packed,
      compressionRatio: packed ? Number((raw / packed).toFixed(2)) : 0,
      bytesPerEntry: this.rows.length ? Number(((indexBytes + packed) / this.rows.length).toFixed(1)) : 0,
    }
  }
}
