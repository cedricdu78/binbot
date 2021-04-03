const binSecret = require('./config/secrets');
const config = require('./config/config');

const Binance = require('node-binance-api');

class Bot {

    api = new Binance().options({
        APIKEY: binSecret.key(),
        APISECRET: binSecret.secret()
    });

    openOrders = []

    async getOpenOrders() {
        await this.api.openOrders().then(openOrders => this.openOrders = openOrders)
    }

    cancelOrders() {
        this.openOrders.forEach(order => {
            this.api.cancel(order.symbol, order.orderId, () => {
                console.log("Cancel: " + order.symbol)
                this.api.marketSell(order.symbol, order['origQty'], { type: 'MARKET' }, () => {
                    console.log("Sell: " + order.symbol)
                })
            })
        })
    }
}

function start(delay = config.restartTime()) {
    new Promise(res => setTimeout(res, delay)).then(() => main())
}

async function main() {

    const myBot = new Bot()

    await myBot.getOpenOrders()

    myBot.cancelOrders()
}

/* Start bot */
start()
