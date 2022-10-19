import {readFile,stat, readdir} from 'fs/promises'
import {getSyllables} from './syllable-parser'
import {join} from 'path'

const corpusToSyllables = async (path) => {
  const stats = await stat(path)

  if (stats.isFile()) return await syllablesInFile(path)
  if (stats.isDirectory()) {
    const files = await readdir(path)
    const syllablesPerFile = await Promise.all(files.map(f => syllablesInFile(join(path,f))))
    return syllablesPerFile.flat()  }
}

const syllablesInFile = async (path) => {
  const text = await readFile(path, 'utf8')
  const syllables = getSyllables(text)
  return syllables
}

export {corpusToSyllables}
