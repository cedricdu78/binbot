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

function order(currency, volume, now, end, mise, gain_now, gain_end, date) {
    const order = Object.create(null)
    order.currency = currency
    order.volume = volume
    order.now = now
    order.end = end
    order.mise = mise
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
    const mise = 30
    const keep_balance = 0

    while (1) {

        try {
            let currencies = []
            let currencies_open = []
            let orders = []
            let new_orders = []
            let total = 0

            currencies_open = await binance.openOrders(undefined, null)
            let balances = await binance.balance(null)

            Object.entries(tickers).forEach(([, value]) => {
                if (value.price > 0) {
                    const _currency = Object.create(null);
                    _currency.key = value.symbol
                    _currency.base = value.symbol.replace("USDT", "")
                    _currency.quote = "USDT"
                    _currency.wsname = _currency.base + "/" + _currency.quote
                    _currency.price = value.price

                    if (balances[_currency.base].available > 0 && ["USDT","BNB"].indexOf(_currency.base) < 0)
                        console.log(_currency.wsname + " has units out of order: "
                            + (Number(balances[_currency.base].available) * value.price).toFixed(2) + "$")

                    if (Number(balances[_currency.base].onOrder) > 0) {
                        let _order = (currencies_open.filter(val => val.symbol === value.symbol))[0]
                        orders.push(order(
                            _currency.wsname,
                            Number(_order['origQty']),
                            Number(value.price),
                            Number(_order.price),
                            mise,
                            Number((value.price * _order['origQty']).toFixed(3)),
                            Number((_order.price * _order['origQty']).toFixed(3)),
                            new Date(_order['time'])
                        ))
                        total += Number((value.price * _order['origQty']).toFixed(3))
                    }

                    if (Number(balances[_currency.base].onOrder) === 0
                        && balances[_currency.base].available === 0)
                        currencies.push(_currency)
                }
            })

            for (let i = 0; i < currencies.length; i++) {
                if (balances["USDT"].available >= (keep_balance + mise)) {
                    new Promise(res => setTimeout(res, 100));

                    let moy = []
                    let res = await binance.candlesticks(currencies[i].key, interval, null, {limit: limit})
                    Object.entries(res).forEach(([, value]) => {
                        moy.push(value[4])
                    })

                    currencies[i].price = res[Object.entries(res).length - 1][4]
                    let min = Math.min.apply(null, moy)
                    let max = Math.max.apply(null, moy)
                    moy = average(moy)
                    let prc = ((max - min) / min) * 100
                    let prcm = ((max - moy) / moy) * 100

                    if (moy * (100 - b_median) / 100 <= currencies[i].price &&
                        moy * (100 - a_median) / 100 >= currencies[i].price &&
                        currencies[i].price > 0 && prc >= 10 && prcm >= 10) {

                        let volume = fixValue(mise / currencies[i].price)
                        await binance.marketBuy(currencies[i].key, volume, (error,) => {
                            if (error !== null) {
                                let responseJson = JSON.parse(error.body)
                                console.log(currencies[i].base + " [" + responseJson.code + "]: " + responseJson["msg"])
                            } else {
                                balances["USDT"].available -= mise
                                let sell_price = fixValue((Number(currencies[i].price) * profit / 100) + Number(currencies[i].price))
                                binance.sell(currencies[i].key, volume, sell_price, {type: 'LIMIT'}, (error,) => {
                                    if (error !== null) {
                                        let responseJson = JSON.parse(error.body)
                                        console.log(currencies[i].base + " [" + responseJson.code + "]: " + responseJson["msg"])
                                    } else {
                                        new_orders.push(order(
                                            currencies[i].wsname,
                                            Number(volume),
                                            Number(currencies[i].price),
                                            Number(sell_price),
                                            mise,
                                            mise,
                                            Number(String(Number(sell_price) * volume).toFixed(3)),
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