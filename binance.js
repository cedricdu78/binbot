const secrets = require('./secrets');

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
});

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
                    console.error(err)
                    conn.end().then()
                })
            }).catch(err => {
            console.error(err)
        })
    });

function getDate(date = new Date()) {
    return date.getFullYear() + "-"
        + (String(date.getUTCMonth()).length === 1 ? ("0" + (date.getMonth() + 1)) : (date.getMonth() + 1)) + "-"
        + (String(date.getDate()).length === 1 ? ("0" + date.getDate()) : date.getDate()) + " "
        + (String(date.getHours()).length === 1 ? ("0" + date.getHours()) : date.getHours()) + "-"
        + (String(date.getMinutes()).length === 1 ? ("0" + date.getMinutes()) : date.getMinutes()) + "-"
        + (String(date.getSeconds()).length === 1 ? ("0" + date.getSeconds()) : date.getSeconds())
}

function order(currency, volume, stopLoss, openValue, nowValue, timestamp, plusValue) {
    const order = Object.create(null)
    order.currency = currency
    order.volume = Number(volume)
    order.stopLoss = Number(stopLoss)
    order.openValue = Number(openValue)
    order.nowValue = Number(nowValue)
    order.date = getDate(new Date(timestamp))
    order.plusValue = Number(plusValue.toFixed(2))
    return order
}

const average = arr => arr.reduce((p, c) => p + c, 0) / arr.length,
    interval = "15m", limit = 673,
    a_median = 0, b_median = 20,
    mise = 60, security = 70,
    keep_balance = 0;

let balance = new Promise(function(resolve, reject) {
    binance.balance((error, balances) => {
        if (error !== null) {
            reject(Error(error));
        }
        else {
            resolve(balances);
        }
    })
});

let openOrders = new Promise(function(resolve, reject) {
    binance.openOrders(undefined,(error, orders) => {
        if (error !== null) {
            reject(Error(error));
        }
        else {
            resolve(orders);
        }
    })
});

let exchangeInfo = new Promise(function(resolve, reject) {
    binance.exchangeInfo((error, exchangeInfo) => {
        if (error !== null) {
            reject(Error(error));
        }
        else {
            resolve(Object.entries(exchangeInfo['symbols']).filter(([, value]) => value.symbol.endsWith('USDT')
                && !value.symbol.endsWith('DOWNUSDT')
                && !value.symbol.endsWith('UPUSDT')
                && !value.symbol.endsWith('BULLUSDT')
                && !value.symbol.endsWith('BEARUSDT')
                && value.status !== 'BREAK'));
        }
    })
});

function candlesticks(currencies) {
    return new Promise(function(resolve, reject) {
        let counter = 0
        Object.entries(currencies).forEach(function([, [, value]]) {
            binance.candlesticks(value.symbol, interval, (error, res) => {
                if (error !== null) {
                    reject(Error(error));
                }
                else {
                    value.moy = []
                    res.forEach(function(val) {
                        value.moy.push(Number(val[4]))
                    })
                    value.price = value.moy[value.moy.length - 1]

                    counter++
                    if (counter === currencies.length) resolve(currencies);
                }
            }, {limit: limit})
        })
    });
}

function noOrders(balances, open_orders) {
    return new Promise(function(resolve, reject) {
        let counter = 0
        Object.entries(open_orders).forEach(([, value]) => {
            if (balances[value.symbol.replace('USDT', '')].available * value.price >= 1
                && value.symbol.replace('USDT', '') !== 'BNB')
                console.error(value.symbol + ' has units out of order: '
                    + (balances[value.symbol.replace('USDT', '')].available * value.price) + '$')

            counter++
            if (counter === Object.entries(open_orders).length) resolve();
        })
    });
}

function changeStopLossSQL(value, _order, orders) {
    return new Promise(function(resolve, reject) {
        let minPrice = (value['filters'].filter(val => val['filterType'] === 'PRICE_FILTER'))[0]
        let minVolume = (value['filters'].filter(val => val['filterType'] === 'LOT_SIZE'))[0]
        let lenPrice = minPrice.minPrice.split('.')[0] === "0" ? (minPrice.minPrice.split('.')[1].split('1')[0] + '1').length : 0
        let lenVol = minVolume.minQty.split('.')[0] === "0" ? (minVolume.minQty.split('.')[1].split('1')[0] + '1').length : 0

        pool.getConnection()
            .then(conn => {
                conn.query(`SELECT * FROM binances.orders WHERE orderId = (?)`, [
                    _order.orderId
                ]).then(res => {
                    if (res[0] !== undefined) {
                        if (value.price >= res[0]['price'] * 1.1
                            && value.price >= res[0]['price'] * (res[0]['prc'] + 10) / 100) {
                            binance.cancel(value.symbol, _order.orderId, () => {
                                if (res[0]['prc'] === security)
                                    res[0]['prc'] = 105
                                else res[0]['prc'] += 5

                                _order.price = String(res[0]['price'] * res[0]['prc'] / 100)
                                _order.price = _order.price.substr(0, _order.price.split('.')[0].length + (lenPrice ? 1 : 0) + lenPrice)

                                _order['origQty'] = _order['origQty'].substr(0, _order['origQty'].split('.')[0].length + (lenVol ? 1 : 0) + lenVol)

                                binance.sell(value.symbol, _order['origQty'], _order.price, {stopPrice: _order.price, type: 'STOP_LOSS_LIMIT'}, (error, response) => {
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
                                            console.error(err)
                                            conn.end().then();
                                        })
                                    }
                                })
                            })
                        }
                        orders[value.symbol] = order(
                            value.symbol,
                            _order['origQty'],
                            _order.price,
                            res[0]['price'],
                            value.price,
                            _order['time'],
                            ((value.price - res[0]['price']) / res[0]['price']) * 100
                        )
                    }
                    resolve(orders);
                    conn.end().then();
                }).catch(err => {
                    conn.end().then();
                    console.error(err);
                });
            })
    });
}

function buySell(currencies, balances, details, new_orders, total) {
    return new Promise(function(resolve, reject) {
        let counter = 0
        Object.entries(currencies).forEach(function([, [, value]]) {
            if (Number(balances[value['baseAsset']].onOrder) === 0
                && Number(balances[value['baseAsset']].available) === 0
                && Number(balances["USDT"].available) >= (keep_balance + mise)) {

                let minPrice = (value['filters'].filter(val => val['filterType'] === 'PRICE_FILTER'))[0]
                let minVolume = (value['filters'].filter(val => val['filterType'] === 'LOT_SIZE'))[0]
                let lenPrice = minPrice.minPrice.split('.')[0] === "0" ? (minPrice.minPrice.split('.')[1].split('1')[0] + '1').length : 0
                let lenVol = minVolume.minQty.split('.')[0] === "0" ? (minVolume.minQty.split('.')[1].split('1')[0] + '1').length : 0

                let min = Math.min.apply(null, value.moy)
                let max = Math.max.apply(null, value.moy)
                value.moy = average(value.moy)
                let prcm = ((max - value.moy) / value.moy) * 100
                let prc = ((max - min) / min) * 100

                if (prc >= 10 && prcm >= 10) {
                    const detail = Object.create(null)
                    detail.currency = value.symbol
                    detail.price = value.price
                    detail.min = min
                    detail.moy = Number(value.moy.toFixed(3))
                    detail.max = max
                    detail.prc = Number(prc.toFixed(0))
                    detail.prcm = Number(prcm.toFixed(0))
                    detail.bm = Number((value.moy * (100 - b_median) / 100).toFixed(6))
                    detail.am = Number((value.moy * (100 - a_median) / 100).toFixed(6))
                    detail.amprice = ((value.price - (value.moy * (100 - a_median) / 100)) / (value.moy * (100 - a_median) / 100)) * 100
                    details.push(detail)
                }

                if (value.moy * (100 - b_median) / 100 <= value.price &&
                    value.moy * (100 - a_median) / 100 >= value.price &&
                    value.price > 0 && prc >= 10 && prcm >= 10) {

                    let volume = String(mise / value.price)
                    volume = volume.substr(0, volume.split('.')[0].length + (lenVol ? 1 : 0) + lenVol)

                    let price = String(value.price * security / 100)
                    price = price.substr(0, price.split('.')[0].length + (lenPrice ? 1 : 0) + lenPrice)

                    binance.marketBuy(value.symbol, volume, (error,) => {
                        if (error !== null) {
                            let responseJson = JSON.parse(error.body)
                            console.error(value.symbol + " [" + responseJson.code + "]: " + responseJson["msg"] + " " + price + " " + volume)
                        } else {
                            console.log(value.symbol + " buy")
                            balances["USDT"].available -= mise
                            binance.sell(value.symbol, volume, price, {stopPrice: price, type: 'STOP_LOSS_LIMIT'}, (error, res) => {
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
                                                res.orderId, value.price, security
                                            ]).then(() => {
                                                conn.end().then();
                                            }).catch(err => {
                                                console.error(err)
                                                conn.end().then();
                                            })
                                        })

                                    new_orders.push(order(
                                        value.symbol,
                                        volume,
                                        price,
                                        value.price,
                                        value.price,
                                        Date.now(),
                                        0
                                    ))
                                    total += mise
                                }
                            })
                        }
                    })
                }
            }

            total += value.price * Number(balances[value['baseAsset']].available)
            total += value.price * Number(balances[value['baseAsset']].onOrder)

            counter++
            if (counter === Object.entries(currencies).length) resolve(total);
        });
    });
}

let balances = []
let open_orders = []
let currencies = []
let orders = []

binance.websockets.bookTickers(undefined, (callback) => {
    let curr = currencies.filter(([, val]) => val.symbol === callback.symbol)
    if (curr.length > 0 && open_orders.length > 0) {
        curr[0][1].price = Number(callback.bestAsk)

        if (balances[callback.symbol.replace('USDT', '')].onOrder > 0) {
            let or = (open_orders.filter(v => v.symbol === callback.symbol))[0]
            if (or !== undefined) {
                changeStopLossSQL(curr[0][1], or, orders).then(null, function(err) {
                    console.error(err);
                });
            } else {
                delete orders[callback.symbol]
            }
        }
    }
});

(async () => {

    while (1) {
        let new_orders = []
        let details = []
        let total = 0

        try {

            await balance.then(function(res) {
                balances = res
            }, function(err) {
                console.error(err);
            });

            await openOrders.then(function(res) {
                open_orders = res
            }, function(err) {
                console.error(err);
            });

            await exchangeInfo.then(async function(res) {
                await candlesticks(res).then(function(res) {
                    currencies = res
                }, function(err) {
                    console.error(err);
                });
            }, function(err) {
                console.error(err);
            });

            await noOrders(balances, open_orders).then(null, function(err) {
                console.error(err);
            });

            await buySell(currencies, balances, details, new_orders, total).then(function(res) {
                total = res
                if (details.length > 0) console.table(details.sort((a, b) => a.amprice - b.amprice).slice(0, 14).reverse())
                console.table(orders.sort((a, b) => b.plusValue - a.plusValue))
                if (new_orders.length > 0) console.table(new_orders)
                console.table({
                    'Balance': {
                        'Available': Number(Number(balances["USDT"].available).toFixed(2)),
                        'Total': Number((Number(total) + Number(balances["USDT"].available)).toFixed(2))
                    }
                })
            }, function(err) {
                console.error(err);
            });
        } catch (err) {
            console.error(err)
        }

        await new Promise(res => setTimeout(res, 15000));
    }
})()
