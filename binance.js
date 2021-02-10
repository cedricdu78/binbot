const secrets = require('./secrets')

const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: secrets.binance_key(),
    APISECRET: secrets.binance_secret()
});

function getDate(date = new Date()) {
    return date.getFullYear() + "-"
        + (String(date.getUTCMonth()).length === 1 ? ("0" + (date.getMonth() + 1)) : (date.getMonth() + 1)) + "-"
        + (String(date.getDate()).length === 1 ? ("0" + date.getDate()) : date.getDate()) + " "
        + (String(date.getHours()).length === 1 ? ("0" + date.getHours()) : date.getHours()) + "-"
        + (String(date.getMinutes()).length === 1 ? ("0" + date.getMinutes()) : date.getMinutes()) + "-"
        + (String(date.getSeconds()).length === 1 ? ("0" + date.getSeconds()) : date.getSeconds())
}

function order(currency, volume, now, end, timestamp) {
    const order = Object.create(null)
    order.currency = currency
    order.volume = Number(volume)
    order.now = Number(now)
    order.end = Number(end)
    order.date = getDate(new Date(timestamp))
    order.success = Number((100 * now / end).toFixed(2))
    return order
}

const average = arr => arr.reduce((p, c) => p + c, 0) / arr.length,
    interval = "15m", limit = 673,
    a_median = 0, b_median = 20,
    mise = 60, profit = 10,
    keep_balance = 0;

(async () => {

    let bookTickers = await binance.bookTickers(undefined, null)
    Object.entries(bookTickers).forEach(([key, value]) => {
        if (!key.endsWith('USDT')
            || key.endsWith('DOWNUSDT')
            || key.endsWith('UPUSDT')
            || key.endsWith('UPUSDT')
            || Number(value.ask) <= 0) {
            delete bookTickers[key]
        } else value.name = key.replace('USDT', '')
    })

    let infos = [] && (await binance.exchangeInfo(null))["symbols"]

    while (1) {

        try {
            let orders = []
            let new_orders = []
            let total = 0
            let details = []

            let currencies_open = [] && await binance.openOrders(undefined, null)
            let balances = [] && await binance.balance(null)

            for (const [key, value] of Object.entries(bookTickers)) {
                if (balances[value.name].available * value.ask >= 1
                    && value.name !== 'BNB')
                    console.log(key + ' has units out of order: '
                        + (balances[value.name].available * value.ask) + '$')

                if (balances[value.name].onOrder > 0) {
                    let _order = (currencies_open.filter(val => val.symbol === key))[0]
                    orders.push(order(
                        key,
                        _order['origQty'],
                        value.ask,
                        _order.price,
                        _order['time']
                    ))
                }

                if (Number(balances[value.name].onOrder) === 0
                    && Number(balances[value.name].available) === 0
                    && Number(balances["USDT"].available) >= (keep_balance + mise)) {
                    let moy = []
                    let res = await binance.candlesticks(key, interval, null, {limit: limit})
                    Object.entries(res).forEach(([, value]) => {
                        moy.push(Number(value[4]))
                    })

                    value.ask = Number(res[Object.entries(res).length - 1][4])
                    let min = Math.min.apply(null, moy)
                    let max = Math.max.apply(null, moy)
                    moy = average(moy)
                    let prcm = ((max - moy) / moy) * 100
                    let prc = ((max - min) / min) * 100

                    if (prc >= 10 && prcm >= 10) {
                        const detail = Object.create(null)
                        detail.currency = key
                        detail.price = value.ask
                        detail.min = min
                        detail.moy = Number(moy.toFixed(3))
                        detail.max = max
                        detail.prc = Number(prc.toFixed(0))
                        detail.prcm = Number(prcm.toFixed(0))
                        detail.bm = Number((moy * (100 - b_median) / 100).toFixed(6))
                        detail.am = Number((moy * (100 - a_median) / 100).toFixed(6))
                        detail.amprice = ((value.ask - (moy * (100 - a_median) / 100)) / (moy * (100 - a_median) / 100)) * 100
                        details.push(detail)
                    }

                    if (moy * (100 - b_median) / 100 <= value.ask &&
                        moy * (100 - a_median) / 100 >= value.ask &&
                        value.ask > 0 && prc >= 10 && prcm >= 10) {

                        let info = (infos.filter(val => val.symbol === key))[0]['filters']
                        let minVolume = (info.filter(val => val['filterType'] === 'LOT_SIZE'))[0]
                        let minPrice = (info.filter(val => val['filterType'] === 'PRICE_FILTER'))[0]

                        let lenVol = minVolume.minQty.split('.')
                        lenVol = lenVol[0] === "0" ? (lenVol[1].split('1')[0] + '1').length : 0
                        let volume = String(mise / value.ask)
                        volume = volume.substr(0, volume.split('.')[0].length + (lenVol ? 1 : 0) + lenVol)

                        let lenPrice = minPrice.minPrice.split('.')
                        lenPrice = lenPrice[0] === "0" ? (lenPrice[1].split('1')[0] + '1').length : 0
                        let price = String((Number(value.ask) * profit / 100) + Number(value.ask))
                        price = price.substr(0, price.split('.')[0].length + (lenPrice ? 1 : 0) + lenPrice)

                        await binance.marketBuy(key, volume, (error,) => {
                            if (error !== null) {
                                let responseJson = JSON.parse(error.body)
                                console.error(key + " [" + responseJson.code + "]: " + responseJson["msg"] + " " + price + " " + volume)
                            } else {
                                console.log(key + " buy")
                                balances["USDT"].available -= mise
                                binance.sell(key, volume, price, {type: 'LIMIT'}, (error,) => {
                                    if (error !== null) {
                                        let responseJson = JSON.parse(error.body)
                                        console.error(key + " [" + responseJson.code + "]: " + responseJson["msg"] + " " + price + " " + volume)
                                    } else {
                                        console.log(key + " sell")
                                        new_orders.push(order(
                                            key,
                                            volume,
                                            value.ask,
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

                total += value.ask * Number(balances[value.name].available)
                total += value.ask * Number(balances[value.name].onOrder)
            }

            if (details.length > 0) console.table(details.sort((a, b) => a.amprice - b.amprice).slice(0, 14).reverse())
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