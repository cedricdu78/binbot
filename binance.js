const secrets = require('./secrets')

const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: secrets.binance_key(),
    APISECRET: secrets.binance_secret()
});

const mariadb = require('mariadb');
const pool = mariadb.createPool({
    host: secrets.mysql_host(),
    user: secrets.mysql_user(),
    password: secrets.mysql_password(),
    connectionLimit: 5
})

pool.getConnection()
    .then(conn => {
        conn.query(`CREATE DATABASE IF NOT EXISTS binances;`)
            .then(() => {
                return conn.query(`
                    CREATE TABLE IF NOT EXISTS
                    binances.orders(
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        orderId INT,
                        price FLOAT,
                        prc INT
                    );
                `).then(() => {
                    conn.end().then()
                }).catch(err => {
                    console.log(err)
                    conn.end().then()
                })
            }).catch(err => {
            console.log(err)
        })
    })

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
    mise = 60, security = 70,
    keep_balance = 0;

(async () => {
    while (1) {
        try {
            let orders = []
            let new_orders = []
            let total = 0
            let details = []

            let infos = [] && (await binance.exchangeInfo(null))["symbols"]
            Object.entries(infos).forEach(([key, value]) => {
                if (!value.symbol.endsWith('USDT')
                    || value.symbol.endsWith('DOWNUSDT')
                    || value.symbol.endsWith('UPUSDT')
                    || value.symbol.endsWith('BULLUSDT')
                    || value.symbol.endsWith('BEARUSDT')
                    || value.status === 'BREAK') {
                    delete infos[key]
                }
            })

            let currencies_open = [] && await binance.openOrders(undefined, null)
            let balances = [] && await binance.balance(null)

            for (const [, value] of Object.entries(infos)) {
                let moy = []
                let res = await binance.candlesticks(value.symbol, interval, null, {limit: limit})
                Object.entries(res).forEach(([, value]) => {
                    moy.push(Number(value[4]))
                })
                value.ask = Number(res[Object.entries(res).length - 1][4])

                if (balances[value['baseAsset']].available * value.ask >= 1
                    && value['baseAsset'] !== 'BNB')
                    console.log(value.symbol + ' has units out of order: '
                        + (balances[value['baseAsset']].available * value.ask) + '$')

                let info = (infos.filter(val => val.symbol === value.symbol))[0]['filters']
                let minPrice = (info.filter(val => val['filterType'] === 'PRICE_FILTER'))[0]
                let minVolume = (info.filter(val => val['filterType'] === 'LOT_SIZE'))[0]

                let lenPrice = minPrice.minPrice.split('.')
                lenPrice = lenPrice[0] === "0" ? (lenPrice[1].split('1')[0] + '1').length : 0

                let lenVol = minVolume.minQty.split('.')
                lenVol = lenVol[0] === "0" ? (lenVol[1].split('1')[0] + '1').length : 0

                if (balances[value['baseAsset']].onOrder > 0) {
                    let _order = (currencies_open.filter(val => val.symbol === value.symbol))[0]
                    console.log(_order)

                    pool.getConnection()
                        .then(conn => {
                            conn.query(`SELECT * FROM binances.orders WHERE orderId = (?)`, [
                                _order.orderId
                            ]).then(res => {
                                if (res[0] !== undefined) {

                                    if (value.ask >= res[0]['price'] * 110 / 100
                                        && value.ask >= res[0]['price'] * res[0]['prc'] / 100) {

                                        let cancel = binance.cancel(value.symbol, _order.orderId)
                                        console.log(cancel)

                                        if (res[0]['prc'] === security)
                                            res[0]['prc'] = 95
                                        else res[0]['prc'] += 5

                                        _order.price = String(res[0]['price'] * res[0]['prc'] / 100)
                                        _order.price = _order.price.substr(0, _order.price.split('.')[0].length + (lenPrice ? 1 : 0) + lenPrice)

                                        _order['origQty'] = _order['origQty'].substr(0, _order['origQty'].split('.')[0].length + (lenVol ? 1 : 0) + lenVol)

                                        binance.sell(value.symbol, _order['origQty'], _order.price, {type: 'LIMIT'}, (error, response) => {
                                            if (error !== null) {
                                                let responseJson = JSON.parse(error.body)
                                                console.error(value.symbol + " [" + responseJson.code + "]: " + responseJson["msg"])
                                            } else {
                                                console.log(value.symbol + " resell")

                                                conn.query(`UPDATE binances.orders
                                                    SET orderId = (?), prc = (?)
                                                    WHERE id = (?)`, [
                                                    response.orderId, res[0]['prc'], res[0].id
                                                ]).then(() => {
                                                    conn.end().then();
                                                }).catch(err => {
                                                    console.error(response.orderId + " " + res[0]['prc'])
                                                    console.error(err)
                                                    conn.end().then();
                                                })
                                            }
                                        })
                                    }
                                }
                                conn.end().then();
                                orders.push(order(
                                    value.symbol,
                                    _order['origQty'],
                                    value.ask,
                                    _order.price,
                                    _order['time']
                                ))
                            }).catch(err => {
                                conn.end().then();
                                console.log(err)
                            });
                        })
                }

                if (Number(balances[value['baseAsset']].onOrder) === 0
                    && Number(balances[value['baseAsset']].available) === 0
                    && Number(balances["USDT"].available) >= (keep_balance + mise)) {

                    let min = Math.min.apply(null, moy)
                    let max = Math.max.apply(null, moy)
                    moy = average(moy)
                    let prcm = ((max - moy) / moy) * 100
                    let prc = ((max - min) / min) * 100

                    if (prc >= 10 && prcm >= 10) {
                        const detail = Object.create(null)
                        detail.currency = value.symbol
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

                        let volume = String(mise / value.ask)
                        volume = volume.substr(0, volume.split('.')[0].length + (lenVol ? 1 : 0) + lenVol)

                        let price = String((Number(value.ask) * security / 100) + Number(value.ask))
                        price = price.substr(0, price.split('.')[0].length + (lenPrice ? 1 : 0) + lenPrice)

                        await binance.marketBuy(value.symbol, volume, (error,) => {
                            if (error !== null) {
                                let responseJson = JSON.parse(error.body)
                                console.error(value.symbol + " [" + responseJson.code + "]: " + responseJson["msg"] + " " + price + " " + volume)
                            } else {
                                console.log(value.symbol + " buy")
                                balances["USDT"].available -= mise
                                binance.sell(value.symbol, volume, price, {type: 'LIMIT'}, (error, res) => {
                                    if (error !== null) {
                                        let responseJson = JSON.parse(error.body)
                                        console.error(value.symbol + " [" + responseJson.code + "]: " + responseJson["msg"] + " " + price + " " + volume)
                                    } else {
                                        console.log(value.symbol + " sell")

                                        pool.getConnection()
                                            .then(conn => {
                                                conn.query(`INSERT INTO binances.orders (
                                                    orderId, price, prc
                                                ) VALUES (?, ?, ?)`, [
                                                    res.orderId, value.ask, security
                                                ]).then(() => {
                                                    conn.end().then();
                                                }).catch(err => {
                                                    console.error(res.orderId + " " + value.ask)
                                                    console.error(err)
                                                    conn.end().then();
                                                })
                                            })

                                        new_orders.push(order(
                                            value.symbol,
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

                total += value.ask * Number(balances[value['baseAsset']].available)
                total += value.ask * Number(balances[value['baseAsset']].onOrder)
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