#!/usr/bin/env node

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { existsSync, readFileSync, writeFileSync} from 'fs'
import {readFile, writeFile } from 'fs/promises'
import filenamifyUrl from 'filenamify-url';

const phillipKDick = "https://www.gutenberg.org/ebooks/author/33399/"

async function getBookListHtml(baseUrl) {
    if (!baseUrl) throw new Error("no baseUrl")
    const safeName = filenamifyUrl(baseUrl)

    if (existsSync(`tmp/${safeName}.html`)) {
        console.log('html existed')
        return readFileSync(`tmp/${safeName}.html`, 'utf8')
    }
    console.log('crawling new html')
    const res = await fetch(baseUrl)
    const text = await res.text()
    console.log(text)
    writeFileSync(`tmp/${safeName}.html`, text, 'utf8')
    return text
}
async function getBookList(baseUrl) {
    const html = await getBookListHtml(baseUrl)
    const dom = new JSDOM(html)
    const lElems = dom.window.document.querySelectorAll('.results li a')
    let links = []
    lElems.forEach(l => links.push(l.getAttribute('href')))
    const bookUrlRegex = new RegExp(/ebooks\/[0-9]+/)
    links = links.filter(l => bookUrlRegex.test(l))
    links = links.map(l => `https://www.gutenberg.org${l}`)
    return links
}

const getBookHtml = async (url) => {
    const safeName = filenamifyUrl(url)
    if (existsSync(`tmp/${safeName}.html`)) {
        console.log('book html existed')
        return await readFile(`tmp/${safeName}.html`, 'utf8')
    }
    console.log('crawling new book html')
    const res = await fetch(url)
    const text = await res.text()
    await writeFile(`tmp/${safeName}.html`, text, 'utf8')
}

const getBookText = async (url) => {
    const html = await getBookHtml(url)
    const dom = new JSDOM(html)
    const lElems = dom.window.document.querySelectorAll('a[type="text/plain"]')
    let links = []
    console.log(lElems.length)
    lElems.forEach(l => links.push(l.getAttribute('href')))
    console.log({links})
    return ''
}
async function getScript(url) {
    url = baseUrl + url
    const res = await fetch(url)
    const text = await res.text()
    const dom = new JSDOM(text)
    const script = dom.window.document.querySelector('.scrolling-script-container').textContent
    console.log(script.replace(/\|/gi, '\n'))
    return script
}
// async function getScripts() {
//     const script = await getScript(url)
//     console.log("gs",script)
//     return script
// }
async function getBooks() {
    const bookList = await getBookList(phillipKDick)
    const bookTexts = await Promise.all(bookList.map(getBookText))
    // return await Promise.all(promises)
}

getBooks()
