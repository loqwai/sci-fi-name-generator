#!/usr/bin/env node

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import {existsSync, writeFileSync } from 'fs'
import filenamifyUrl from 'filenamify-url';

const phillipKDick = "https://www.gutenberg.org/ebooks/author/33399/"

async function getBookListHtml(baseUrl) {
    if(!baseUrl) throw new Error("no baseUrl")
    const safeName = filenamifyUrl(baseUrl)

    if(existsSync(`tmp/${safeName}.html`)) {
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
    const lElems = dom.window.document.querySelectorAll('.results')
    const links = []
    lElems.forEach(console.log)
    return links
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
    const episodeList = await getBookList(phillipKDick)
    // const promises = map(episodeList, getScript)
    // return await Promise.all(promises)
}

getBooks()
