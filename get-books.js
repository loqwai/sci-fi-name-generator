#!/usr/bin/env node

import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { existsSync, readFileSync, writeFileSync} from 'fs'
import {readFile, writeFile } from 'fs/promises'
import filenamifyUrl from 'filenamify-url';

const baseUrl = 'https://www.gutenberg.org'
const phillipKDick = "https://www.gutenberg.org/ebooks/author/33399/"
const janeAusten = "https://www.gutenberg.org/ebooks/author/1544"
// const
async function getBookListHtml(bookIndexUrl) {
    if (!bookIndexUrl) throw new Error("no baseUrl")
    const safeName = filenamifyUrl(bookIndexUrl)

    if (existsSync(`tmp/${safeName}.html`)) {
        console.log('html existed')
        return readFileSync(`tmp/${safeName}.html`, 'utf8')
    }
    console.log('crawling new html')
    const res = await fetch(bookIndexUrl)
    const text = await res.text()
    console.log(text)
    writeFileSync(`tmp/${safeName}.html`, text, 'utf8')
    return text
}
async function getBookList(bookshelfUrl) {
    const html = await getBookListHtml(bookshelfUrl)
    const dom = new JSDOM(html)
    const lElems = dom.window.document.querySelectorAll('.results li a')
    let links = []
    lElems.forEach(l => links.push(l.getAttribute('href')))
    const bookUrlRegex = new RegExp(/ebooks\/[0-9]+/)
    links = links.filter(l => bookUrlRegex.test(l))
    links = links.map(l => `${baseUrl}/${l}`)
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
    writeFile(`tmp/${safeName}.html`, text, 'utf8')
    return text
}

const getBookTextUrl = async (url) => {
    const html = await getBookHtml(url)
    const dom = new JSDOM(html)
    const lElems = dom.window.document.querySelectorAll('a[type="text/plain"]')
    if (lElems.length !== 1) throw new Error(`no plain text link for ${url}`)
    let links = []
    lElems.forEach(l => links.push(l.getAttribute('href')))
    links = links.map(l => `${baseUrl}${l}`)
    console.log(links[0])
    return links[0]
}

const getBookText = async(url) =>{
    const textUrl = await getBookTextUrl(url)
    console.log({textUrl})
    const safeName = filenamifyUrl(textUrl)
    if (existsSync(`tmp/${safeName}.txt`)) {
        console.log('book txt existed')
        return await readFile(`tmp/${safeName}.txt`, 'utf8')
    }
    console.log('crawling new book txt')
    const res = await fetch(textUrl)
    const text = await res.text()
    writeFile(`tmp/${safeName}.txt`, text, 'utf8')
    return text
}
async function getBooks(bookShelfUrl) {
    if(!bookShelfUrl) throw new Error('I need to know where to begin crawling')
    const bookList = await getBookList(bookShelfUrl)
    console.log({bookList})
    const bookTexts = await Promise.all(bookList.map(getBookText))
    console.log(bookTexts)
    // return await Promise.all(promises)
}

const bookShelfUrl =  '' //TODO: pass this in from the cli
getBooks(bookShelfUrl || janeAusten)
