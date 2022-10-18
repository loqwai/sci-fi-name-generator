const syllableRegex = /[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi

const syllabify = (words) => {
  return words.match(syllableRegex)
}

export default syllabify
