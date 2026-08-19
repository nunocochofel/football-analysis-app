// Pure, dependency-free fMP4 box-boundary parsing. No ffmpeg/HTTP/fs knowledge here — this exists
// purely to slice ffmpeg's continuous stdout byte stream into independently-storable units (see
// liveBuffer.ts): one init segment (ftyp+moov, emitted once) followed by a stream of fragments
// (moof+mdat pairs, one per GOP thanks to -movflags frag_keyframe). A raw byte stream has no such
// boundaries on its own — Node's 'data' events split chunks at arbitrary points, never aligned to
// box edges.

export interface Mp4Box {
  type: string // 4-char box type, e.g. 'ftyp', 'moov', 'moof', 'mdat'
  bytes: Buffer // the COMPLETE box, its own header included
}

interface BoxRange {
  type: string
  start: number
  end: number
}

// Standard ISO BMFF box header: [uint32 size][4-char type], size includes the header itself.
// size===1 means a 64-bit "largesize" follows immediately (boxes >4GiB) — never actually hit for a
// single fMP4 fragment in practice, handled anyway rather than silently corrupting the stream on
// the rare encoder that emits one. size===0 ("box extends to end of file") has no meaning for a
// live, endless stream, so the carry is dropped to avoid waiting forever for a length that will
// never arrive.
function iterateBoxes(buf: Buffer): BoxRange[] {
  const out: BoxRange[] = []
  let offset = 0
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset)
    let headerLen = 8
    if (size === 1) {
      if (offset + 16 > buf.length) break
      const high = buf.readUInt32BE(offset + 8)
      const low = buf.readUInt32BE(offset + 12)
      size = high * 2 ** 32 + low
      headerLen = 16
    }
    if (size < headerLen || offset + size > buf.length) break
    const type = buf.toString('ascii', offset + 4, offset + 8)
    out.push({ type, start: offset, end: offset + size })
    offset += size
  }
  return out
}

// Incremental splitter: feed it whatever chunks arrive from ffmpeg's stdout, in order; it hands
// back zero or more COMPLETE boxes per call, buffering only the small partial tail of whatever box
// is still in-flight (bounded by one box's size — an `mdat` for a keyframe-heavy fragment can span
// several chunks, everything else is typically well under a chunk).
export class Mp4BoxSplitter {
  private carry: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): Mp4Box[] {
    this.carry = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk
    const boxes: Mp4Box[] = []
    for (;;) {
      if (this.carry.length < 8) break
      const size0 = this.carry.readUInt32BE(0)
      if (size0 === 0) {
        this.carry = Buffer.alloc(0)
        break
      }
      const ranges = iterateBoxes(this.carry)
      if (ranges.length === 0) break // header known but full box not yet available
      const r = ranges[0]
      boxes.push({ type: r.type, bytes: this.carry.subarray(r.start, r.end) })
      this.carry = this.carry.subarray(r.end)
    }
    return boxes
  }
}

// Where a container box's CHILDREN begin, relative to the box's own start — accounting for the two
// non-generic shapes needed to walk down to `avcC`: `stsd` (a FullBox: 4 bytes version+flags, then
// 4 bytes entry_count, THEN its children) and `avc1` (a VisualSampleEntry: a fixed 78-byte header
// before its own children). Every other box on the path to avcC (moov/trak/mdia/minf/stbl) is a
// plain container with children immediately after the generic 8-byte box header.
function childrenContentRange(type: string, box: BoxRange): { start: number; end: number } {
  let childStart = box.start + 8
  if (type === 'stsd') childStart += 8
  else if (type === 'avc1' || type === 'hev1' || type === 'hvc1') childStart += 78
  return { start: childStart, end: box.end }
}

// Descends a dot-path of box types (e.g. ['trak','mdia','minf','stbl','stsd','avc1','avcC']) inside
// `buf`, where `buf` itself IS the first path element's box (header included). Returns the LAST
// element's own content (past its own header) — exactly the payload callers want for a leaf box
// like avcC — or null if any step along the way isn't found (a malformed/unexpected init segment
// shape, e.g. HEVC instead of AVC), never throws.
function findBoxRecursive(buf: Buffer, path: string[]): Buffer | null {
  let range = { start: 0, end: buf.length }
  for (const wanted of path) {
    const boxes = iterateBoxes(buf.subarray(range.start, range.end)).map((b) => ({
      type: b.type,
      start: b.start + range.start,
      end: b.end + range.start
    }))
    const found = boxes.find((b) => b.type === wanted)
    if (!found) return null
    range = childrenContentRange(wanted, found)
  }
  return buf.subarray(range.start, range.end)
}

const FALLBACK_AVC_CODEC = 'avc1.64001f' // High profile, level 3.1 — common, broadly-supported default matching typical 720p/1080p RTMP encoder output

// Pulls the EXACT AVC profile/compatibility/level bytes out of the init segment's avcC box, so the
// renderer's MediaSource SourceBuffer codec string matches the actual encoded stream byte-for-byte.
// This matters because ffmpeg is invoked with -c:v copy (see liveIngest.ts) — the profile/level in
// use is whatever the RTMP source itself encoded, unknowable ahead of time; guessing a fixed string
// would work for some sources and silently fail addSourceBuffer()/appendBuffer() for others. Tries
// every video track (not just the first trak) in case the first one isn't the video track, and
// falls back to a safe common default if avcC can't be found in any of them, rather than throwing —
// worst case is a slightly-wrong-but-usually-still-compatible codec string, not a crash.
export function extractAvcCodecString(initSegmentBytes: Buffer): string {
  const moov = findBoxRecursive(initSegmentBytes, ['moov'])
  if (!moov) return FALLBACK_AVC_CODEC
  const trakRanges = iterateBoxes(moov).filter((b) => b.type === 'trak')
  for (const trak of trakRanges) {
    const trakBytes = moov.subarray(trak.start, trak.end)
    const avcC = findBoxRecursive(trakBytes, ['trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1', 'avcC'])
    if (avcC && avcC.length >= 4) {
      const hex = (n: number): string => n.toString(16).padStart(2, '0')
      return `avc1.${hex(avcC[1])}${hex(avcC[2])}${hex(avcC[3])}`
    }
  }
  return FALLBACK_AVC_CODEC
}
