const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./lib/func');

const Binance = require('node-binance-api');

class Bot {

    api = new Binance().options({
        APIKEY: binSecret.key(),
        APISECRET: binSecret.secret()
    });

    bookTickers = []

    histories = []
    candles = []

    priceSell = 0

    available = 2000
    order = []
    mise = 95



    async getBookTickers() {
        this.bookTickers = []
        await this.api.bookTickers("NANOUSDT").then(v => this.bookTickers.push({symbol: v.symbol, price: Number(v.askPrice)}))
    }

    getCurrenciesFilteredByConditions() {
        let tm = new Date()
        // console.log(tm)
        tm = (tm.getHours().toString().length === 1 ? '0' + tm.getHours() : tm.getHours()) + ":" + (tm.getMinutes().toString().length === 1 ? '0' + tm.getMinutes() : tm.getMinutes())
        if (this.histories[tm] !== undefined)
            this.histories[tm].push(this.bookTickers[0].price)
        else {
            let tm2 = String(Number(tm.substr(3,2)) - 1)
            let last = tm.substr(0,3) + (tm2.length === 1 ? "0" + tm2 : tm2)
            if (this.histories[last] !== undefined) {
                let open = 0, low = 9999999999, high = 0, close = 0

                for (let i = 0; i < this.histories[last].length; i++) {
                    if (open === 0) open = this.histories[last][i]
                    if (this.histories[last][i] < low) low = this.histories[last][i]
                    if (this.histories[last][i] > high) high = this.histories[last][i]
                    if (i === this.histories[last].length - 1) close = this.histories[last][i]
                }

                this.candles.push({open: open, high: high, low: low, close: close, green: close > open})
            }

            this.histories[tm] = [this.bookTickers[0].price]
        }

        if (this.candles.length >= 2) {

            let prc = Number(((this.candles[this.candles.length - 1].close - this.candles[this.candles.length - 2].open)
                / this.candles[this.candles.length - 2].open) * 100)

            if (this.candles[this.candles.length - 1].green && this.candles[this.candles.length - 2].green
                && this.bookTickers[0].price > this.priceSell) {
                console.log("BUY")
                console.log(prc)
                this.candles = []
            }
            else if (!this.candles[this.candles.length - 1].green && !this.candles[this.candles.length - 2].green) {
                console.log("SELL")
                console.log(prc)
                this.priceSell = this.candles[this.candles.length - 2].open
                this.candles = []
            } else this.candles.shift()
        }
    }
}

const myBot = new Bot()

function start(delay = config.restartTime()) {
    new Promise(res => setTimeout(res, delay)).then(() => main(myBot))
}

async function main(myBot) {

    await myBot.getBookTickers()

    myBot.getCurrenciesFilteredByConditions()

    start(0)
}

start(0)
