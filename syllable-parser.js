const syllableRegex = /[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi

export const syllabify = (words) => {
  return words.match(syllableRegex).map(syllable => syllable.toLowerCase())
}

export default syllabify
