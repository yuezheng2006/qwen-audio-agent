export function organizeBooks(payload = {}) {
  const books = Array.isArray(payload.books) ? payload.books : []
  const loose = Array.isArray(payload.loose) ? payload.loose : []
  const shelves = books.map(book => ({
    ...book,
    kind: 'book',
  }))
  if (loose.length) {
    shelves.push({
      slug: '_loose',
      title: '未分章',
      catalog: false,
      chapterCount: loose.length,
      chapters: loose.map((item, index) => ({
        order: index + 1,
        title: item.title,
        id: item.id,
        relativePath: item.relativePath,
        bytes: item.bytes,
      })),
      kind: 'loose',
    })
  }
  return shelves
}

export function cursorFor(cursors, contentId) {
  return (cursors || []).find(item => item.contentId === contentId) || null
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}
