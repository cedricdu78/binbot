const secrets = require('./secrets')

const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: secrets.binance_key(),
    APISECRET: secrets.binance_secret()
});

function order(currency, volume, now, end, timestamp) {
    const order = Object.create(null)
    order.currency = currency
    order.volume = Number(volume)
    order.now = Number(now)
    order.end = Number(end)
    order.date = new Date(timestamp).toLocaleString('fr-FR')
    order.success = Number((100 * now / end).toFixed(2))
    return order
}

const average = arr => arr.reduce((p, c) => p + c, 0) / arr.length,
    interval = '15m', limit = 673,
    a_median = 0, b_median = 20,
    mise = 40, profit = 10,
    keep_balance = 0

let tickers = []
binance.websockets.bookTickers(undefined, (callback) => {
    if (callback.symbol.endsWith('USDT')
        && !callback.symbol.endsWith('DOWNUSDT')
        && !callback.symbol.endsWith('UPUSDT')
        && !callback.symbol.startsWith('USDT')
        && !callback.symbol.startsWith('BNB')
        && Number(callback.bestAsk) > 0) {
        let ticker = (tickers.filter(item => item.symbol === callback.symbol))[0]
        if (ticker !== undefined) ticker.price = callback.bestAsk
        else tickers.push({
            'symbol': callback.symbol,
            'name': callback.symbol.replace('USDT', ''),
            'price': callback.bestAsk
        })
    }
});

(async () => {

    let infos = [] && (await binance.exchangeInfo(null))["symbols"]

    while (1) {

        try {
            let orders = []
            let new_orders = []
            let total = 0
            let details = []

            let currencies_open = [] && await binance.openOrders(undefined, null)
            let balances = [] && await binance.balance(null)

            for (const [, value] of Object.entries(tickers)) {
                try {
                    if (balances[value.name].available > 0)
                        console.log(value.name + ' has units out of order: '
                            + (balances[value.name].available * value.price) + '$')

                    if (balances[value.name].onOrder > 0) {
                        let _order = (currencies_open.filter(val => val.symbol === value.symbol))[0]
                        orders.push(order(
                            value.symbol,
                            _order['origQty'],
                            value.price,
                            _order.price,
                            _order['time']
                        ))
                        total += value.price * _order['origQty']
                    }

                    if (Number(balances[value.name].onOrder) === 0
                        && Number(balances[value.name].available) === 0
                        && Number(balances["USDT"].available) >= (keep_balance + mise)) {
                        let moy = []
                        let res = await binance.candlesticks(value.symbol, interval, null, {limit: limit})
                        Object.entries(res).forEach(([, value]) => {
                            moy.push(Number(value[4]))
                        })

                        value.price = Number(res[Object.entries(res).length - 1][4])
                        let min = Math.min.apply(null, moy)
                        let max = Math.max.apply(null, moy)
                        moy = average(moy)
                        let prc = ((max - min) / min) * 100
                        let prcm = ((max - moy) / moy) * 100

                        const detail = Object.create(null)
                        detail.currency = value.name
                        detail.price = value.price
                        detail.min = min
                        detail.moy = Number(moy.toFixed(3))
                        detail.max = max
                        detail.prc = Number(prc.toFixed(0))
                        detail.prcm = Number(prcm.toFixed(0))
                        detail.bm = Number((moy * (100 - b_median) / 100).toFixed(6))
                        detail.am = Number((moy * (100 - a_median) / 100).toFixed(6))
                        detail.amprice = ((value.price - (moy * (100 - a_median) / 100)) / (moy * (100 - a_median) / 100)) * 100
                        if (prc >= 10 && prcm >= 10) details.push(detail)

                        if (moy * (100 - b_median) / 100 <= value.price &&
                            moy * (100 - a_median) / 100 >= value.price &&
                            value.price > 0 && prc >= 10 && prcm >= 10) {

                            let info = (infos.filter(val => val.symbol === value.symbol))[0]['filters']
                            let minVolume = (info.filter(val => val['filterType'] === 'LOT_SIZE'))[0]
                            let minPrice = (info.filter(val => val['filterType'] === 'PRICE_FILTER'))[0]

                            let lenVol = Number(minVolume.minQty).toString().split('.')
                            lenVol = lenVol.length > 0 ? lenVol[1].length : 0
                            let volume = Number((mise / value.price).toFixed(lenVol))

                            let lenPrice = Number(minPrice.minPrice).toString().split('.')
                            lenPrice = lenPrice.length > 0 ? lenPrice[1].length : 0
                            let price = Number(((Number(value.price) * profit / 100) + Number(value.price)).toFixed(lenPrice))

                            await binance.marketBuy(value.symbol, volume, (error,) => {
                                if (error !== null) {
                                    let responseJson = JSON.parse(error.body)
                                    console.log(base + " [" + responseJson.code + "]: " + responseJson["msg"])
                                } else {
                                    balances["USDT"].available -= mise
                                    binance.sell(value.symbol, volume, price, {type: 'LIMIT'}, (error,) => {
                                        if (error !== null) {
                                            let responseJson = JSON.parse(error.body)
                                            console.log(base + " [" + responseJson.code + "]: " + responseJson["msg"])
                                        } else {
                                            new_orders.push(order(
                                                value.name,
                                                volume,
                                                value.price,
                                                price,
                                                Date.now()
                                            ))
                                            total += mise
                                        }
                                    })
                                }
                            })
                        }
                    }
                } catch (err) {
                    console.error(value.name + " = { " + err + " }")
                }
            }

            if (details.length > 0) console.table(details.sort((a, b) => a.amprice - b.amprice).slice(0, 14))
            if (orders.length > 0) console.table(orders.sort((a, b) => b.success - a.success))
            if (new_orders.length > 0) console.table(new_orders)
            console.table({
                'Balance': {
                    'Available': Number(Number(balances["USDT"].available).toFixed(2)),
                    'Total': Number((Number(total) + Number(balances["USDT"].available)).toFixed(2))
                }
            })
        } catch (err) {
            console.error(err)
        }

        await new Promise(res => setTimeout(res, 30000));
    }
})()
