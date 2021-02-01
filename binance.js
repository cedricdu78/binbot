const secrets = require('./secrets')

const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: secrets.binance_key(),
    APISECRET: secrets.binance_secret()
});

function average(a) {
    let b = a.length,
        c = 0, i;
    for (i = 0; i < b; i++){
        c += Number(a[i]);
    }
    return c/b;
}

const whitelist = [
    "AAVEUSDT", "ADAUSDT", "ALGOUSDT", "ANTUSDT", "ATOMUSDT", "BALUSDT", "GRTUSDT","FLOWUSDT",
    "BATUSDT", "BCHUSDT", "COMPUSDT", "CRVUSDT", "DASHUSDT", "DOTUSDT", "EOSUSDT", "FILUSDT",
    "ICXUSDT", "KAVAUSDT", "KEEPUSDT", "KNCUSDT", "KSMUSDT", "LINKUSDT", "LSKUSDT", "ETHUSDT",
    "MANAUSDT", "NANOUSDT", "OMGUSDT", "OXTUSDT", "QTUMUSDT", "REPV2USDT", "GNOUSDT", "ZECUSDT",
    "SCUSDT", "SNXUSDT", "STORJUSDT", "TRXUSDT", "UNIUSDT", "WAVESUSDT", "XDGUSDT", "ETCUSDT",
    "LTCUSDT", "MLNUSDT", "REPUSDT", "XTZUSDT", "XBTUSDT", "XLMUSDT", "XMRUSDT", "XRPUSDT",
]

let tickers = []
binance.websockets.bookTickers(undefined, (callback) => {
    if (whitelist.indexOf(callback.symbol) > -1 && Number(callback.bestAsk) !== 0) {
        tickers = tickers.filter(item => item.symbol !== callback.symbol)
        tickers.push({"symbol": callback.symbol, "bestAsk": callback.bestAsk})
    }
});

(async () => {
    const interval = "15m", limit = 673
    const a_median = 0, b_median = 20
    const profit = 10
    const mise = 30
    const keep_balance = 0

    while (1) {

        try {
            let currencies = []
            let orders = []
            let new_orders = []

            let balance = (await binance.balance(null)).USDT.available;
            let currencies_open = await binance.openOrders()

            Object.entries(tickers).forEach(([key, value]) => {
                const _currency = Object.create(null);
                _currency.key = value.symbol
                _currency.altname = value.symbol
                _currency.base = value.symbol.replace("USDT", "")
                _currency.quote = "USDT"
                _currency.wsname = _currency.base + "/" + _currency.quote
                _currency.ordermin = 0
                _currency.price = value.bestAsk
                currencies.push(_currency)
            })

            for (let i = 0; i < currencies_open.length; i++) {
                Object.entries(currencies).forEach(([, value]) => {
                    if (currencies_open[i].symbol === value.key) {
                        const order = Object.create(null);
                        order.currency = value.wsname
                        order.volume = Number(currencies_open[i]['origQty'])
                        order.now = Number(Number((value.price)).toFixed(3))
                        order.end = Number(currencies_open[i]['price'])
                        order.mise = mise
                        order.gain_now = Number((value.price * currencies_open[i]['origQty']).toFixed(3))
                        order.gain_end = Number((currencies_open[i]['price'] * currencies_open[i]['origQty']).toFixed(3))
                        let date = new Date(currencies_open[i]['time'])
                        order.date = date.getFullYear() + '-' +
                            ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
                            ('0' + date.getDate()).slice(-2) + ' ' +
                            ('0' + date.getHours()).slice(-2) + ':' +
                            ('0' + date.getMinutes()).slice(-2) + ':' +
                            ('0' + date.getSeconds()).slice(-2)
                        order.success = Number((100 * order.gain_now / order.gain_end * 0.992).toFixed(2))
                        orders.push(order)
                    }
                })
            }

            Object.entries(currencies_open).forEach(([, value]) => {
                currencies = currencies.filter(item => item.altname !== value.symbol)
            })

            for (let i = 0; i < currencies.length; i++) {
                if (balance >= (keep_balance + mise)) {
                    new Promise(res => setTimeout(res, 100));

                    let moy = []
                    let res = await binance.candlesticks(currencies[i].key, interval, null, {limit: limit})
                    Object.entries(res).forEach(([key, value]) => {
                        moy.push(value[4])
                    })

                    currencies[i].price = res[Object.entries(res).length - 1][4]
                    moy = average(moy)

                    if (moy * (100 - b_median) / 100 <= currencies[i].price &&
                        moy * (100 - a_median) / 100 >= currencies[i].price &&
                        currencies[i].price > 0) {

                        let volume = (mise / currencies[i].price)

                        if (String(volume).split('.')[0] > 99)
                            volume = volume.toFixed(0)
                        else if (String(volume).split('.')[0] > 9)
                            volume = volume.toFixed(1)
                        else if (String(volume).split('.')[0] > 0)
                            volume = volume.toFixed(2)
                        else
                            volume = volume.toFixed(3)

                        await binance.marketBuy(currencies[i].key, volume, (error,) => {
                            if (error !== null) {
                                let responseJson = JSON.parse(error.body)
                                console.log(currencies[i].base + " [" + responseJson.code + "]: " + responseJson.msg)
                            } else {
                                balance -= mise
                                let sell_price = (Number(currencies[i].price) * profit / 100) + Number(currencies[i].price)
                                if (String(sell_price).split('.')[0] > 99)
                                    sell_price = sell_price.toFixed(0)
                                else if (String(sell_price).split('.')[0] > 9)
                                    sell_price = sell_price.toFixed(1)
                                else if (String(sell_price).split('.')[0] > 0)
                                    sell_price = sell_price.toFixed(2)
                                else
                                    sell_price = sell_price.toFixed(3)
                                binance.sell(currencies[i].key, volume, sell_price, {type: 'LIMIT'}, (error,) => {
                                    if (error !== null) {
                                        let responseJson = JSON.parse(error.body)
                                        console.log(currencies[i].base + " [" + responseJson.code + "]: " + responseJson.msg)
                                    } else {
                                        let plus_value = Math.round(Number(mise) / Number(currencies[i].price) * 100000) / 100000
                                        const order = Object.create(null);
                                        order.currency = currencies[i].wsname
                                        order.volume = volume
                                        order.start = Number(currencies[i].price)
                                        order.now = Number(currencies[i].price)
                                        order.end = sell_price
                                        order.mise = mise
                                        order.gain_now = mise
                                        order.gain_end = plus_value
                                        let date = new Date()
                                        order.date = date.getUTCFullYear() + '-' +
                                            ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
                                            ('0' + date.getDate()).slice(-2) + ' ' +
                                            ('0' + date.getHours()).slice(-2) + ':' +
                                            ('0' + date.getMinutes()).slice(-2) + ':' +
                                            ('0' + date.getSeconds()).slice(-2)
                                        order.success = Number((100 * order.gain_now / order.gain_end).toFixed(2))
                                        new_orders.push(order)
                                    }
                                })
                            }
                        })
                    }
                }
            }

            if (orders.length > 0) console.table(orders.sort((a , b) => b.success - a.success))
            if (new_orders.length > 0) console.table(new_orders)
            console.table({'balance ($)': Number(Number(balance).toFixed(2)), 'Number Crypto': tickers.length})
        } catch (err) {
            console.error(err)
        }

        await new Promise(res => setTimeout(res, 30000));
    }
})()