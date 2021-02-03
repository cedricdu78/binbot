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

function fixValue(value) {
    if (String(value).split('.')[0] > 99)
        return value.toFixed(0)
    else if (String(value).split('.')[0] > 9)
        return value.toFixed(1)
    else if (String(value).split('.')[0] > 0)
        return value.toFixed(2)
    else
        return value.toFixed(5)
}

function order(currency, volume, now, end, gain_now, gain_end, date) {
    const order = Object.create(null)
    order.currency = currency
    order.volume = volume
    order.now = now
    order.end = end
    order.gain_now = gain_now
    order.gain_end = gain_end
    order.date = date
    order.success = Number((100 * order.gain_now / order.gain_end * 0.992).toFixed(2))
    return order
}

let tickers = []
binance.websockets.bookTickers(undefined, (callback) => {
    if (callback.symbol.endsWith("USDT")
        && !callback.symbol.endsWith("DOWNUSDT")
        && !callback.symbol.endsWith("UPUSDT")
        && Number(callback.bestAsk) !== 0) {
        tickers = tickers.filter(item => item.symbol !== callback.symbol)
        tickers.push({"symbol": callback.symbol, "price": callback.bestAsk})
    }
});

(async () => {
    const interval = "15m", limit = 673
    const a_median = 0, b_median = 20
    const profit = 10
    const mise = 40
    const keep_balance = 0

    while (1) {

        try {
            let currencies_open
            let orders = []
            let new_orders = []
            let total = 0

            currencies_open = await binance.openOrders(undefined, null)
            let balances = await binance.balance(null)

            for (const [, value] of Object.entries(tickers)) {
                let base = value.symbol.replace("USDT", "")
                let name = base + "/" + "USDT"

                if (balances[base].available > 0 && ["USDT","BNB"].indexOf(base) < 0)
                    console.log(name + " has units out of order: "
                        + (Number(balances[base].available) * value.price).toFixed(2) + "$")

                if (Number(balances[base].onOrder) > 0) {
                    let _order = (currencies_open.filter(val => val.symbol === value.symbol))[0]
                    orders.push(order(
                        name,
                        Number(_order['origQty']),
                        Number(value.price),
                        Number(_order.price),
                        Number((value.price * _order['origQty']).toFixed(3)),
                        Number((_order.price * _order['origQty']).toFixed(3)),
                        new Date(_order['time'])
                    ))
                    total += Number((value.price * _order['origQty']).toFixed(3))
                }

                if (Number(balances[base].onOrder) === 0
                    && Number(balances[base].available) === 0
                    && balances["USDT"].available >= (keep_balance + mise)) {
                    let moy = []
                    let res = await binance.candlesticks(value.symbol, interval, null, {limit: limit})
                    Object.entries(res).forEach(([, value]) => {
                        moy.push(value[4])
                    })

                    value.price = res[Object.entries(res).length - 1][4]
                    let min = Math.min.apply(null, moy)
                    let max = Math.max.apply(null, moy)
                    moy = average(moy)
                    let prc = ((max - min) / min) * 100
                    let prcm = ((max - moy) / moy) * 100

                    if (moy * (100 - b_median) / 100 <= value.price &&
                        moy * (100 - a_median) / 100 >= value.price &&
                        value.price > 0 && prc >= 10 && prcm >= 10) {

                        let volume = fixValue(mise / value.price)
                        await binance.marketBuy(value.symbol, volume, (error,) => {
                            if (error !== null) {
                                let responseJson = JSON.parse(error.body)
                                console.log(base + " [" + responseJson.code + "]: " + responseJson["msg"])
                            } else {
                                balances["USDT"].available -= mise
                                let sell_price = fixValue((Number(value.price) * profit / 100) + Number(value.price))
                                binance.sell(value.symbol, volume, sell_price, {type: 'LIMIT'}, (error,) => {
                                    if (error !== null) {
                                        let responseJson = JSON.parse(error.body)
                                        console.log(base + " [" + responseJson.code + "]: " + responseJson["msg"])
                                    } else {
                                        new_orders.push(order(
                                            name,
                                            Number(volume),
                                            Number(value.price),
                                            Number(sell_price),
                                            mise,
                                            Number(Number(sell_price) * Number(volume)).toFixed(3),
                                            new Date()
                                        ))
                                        total += mise
                                    }
                                })
                            }
                        })
                    }
                }
            }

            if (orders.length > 0) console.table(orders.sort((a , b) => b.success - a.success))
            if (new_orders.length > 0) console.table(new_orders)
            console.table({
                'Balance': {
                    'Available': Number(Number(balances["USDT"].available).toFixed(2)),
                    'Total': Number(Number(total + Number(balances["USDT"].available)).toFixed(2)),
                }
            })
        } catch (err) {
            console.error(err)
        }

        await new Promise(res => setTimeout(res, 30000));
    }
})()
