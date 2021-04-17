const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./lib/func');

const Binance = require('node-binance-api');

class Bot {

    api = new Binance().options({
        APIKEY: binSecret.key(),
        APISECRET: binSecret.secret()
    });

    balances = []
    exchangeInfo = []
    openOrders = []
    bookTickers = []

    histories = []
    candles = []
    currencies = []
    orders = []
    new_orders = []
    mise = 0

    available = 0
    total = 0

    gain = 1
    priceSell = 0

    async getBookTickers() {
        this.bookTickers = []
        await this.api.bookTickers("NANOUSDT").then(v => this.bookTickers.push({symbol: v.symbol, price: Number(v.askPrice)}))
    }

    getCurrenciesFilteredByConditions() {
        // console.log(new Date().getSeconds())
        let tm = new Date().toLocaleTimeString().substr(0,5)
        if (this.histories[tm] !== undefined)
            this.histories[tm].push(this.bookTickers[0].price)
        else {
            let tm2 = String(Number(tm.substr(3,4)) - 1)
            let last = tm.substr(0,3) + (tm2.length === 1 ? "0" + tm2 : tm2)

            if (this.histories[last] !== undefined) {
                let start = 0, low = 9999999999, high = 0, close = 0

                for(let i = 0; i < this.histories[last].length; i++) {
                    if (start === 0) start = this.histories[last][i]
                    if (this.histories[last][i] < low) low = this.histories[last][i]
                    if (this.histories[last][i] > high) high = this.histories[last][i]
                    if (i === this.histories[last].length - 1) close = this.histories[last][i]
                }

                this.candles.push({start: start, high: high, low: low, close: close, green: close > start})
            }

            this.histories[tm] = [this.bookTickers[0].price]
        }

        if (this.candles.length >= 2) {
            if (this.candles[this.candles.length - 1].green && this.candles[this.candles.length - 2].green
                && this.bookTickers[0].price > this.priceSell) {
                console.log("BUY")
                this.candles = []
            }
            if (!this.candles[this.candles.length - 1].green && !this.candles[this.candles.length - 2].green) {
                console.log("SELL")
                this.priceSell = this.bookTickers[0].price
                this.candles = []
            }
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
