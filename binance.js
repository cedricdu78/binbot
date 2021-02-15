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

function balance() {
    try {
        return new Promise(function(resolve, reject) {
            binance.balance((error, balances) => {
                if (error !== null)
                    reject(Error(error));
                else resolve(balances);
            })
        });
    } catch (err) {
        console.error(err)
    }
}

function openOrders() {
    try {
        return new Promise(function(resolve, reject) {
            binance.openOrders(undefined,(error, orders) => {
                if (error !== null)
                    reject(Error(error));
                else resolve(orders);
            })
        });
    } catch (err) {
        console.error(err)
    }
}

function exchangeInfo() {
    try {
        return new Promise(function(resolve, reject) {
            binance.exchangeInfo((error, exchangeInfo) => {
                if (error !== null)
                    reject(Error(error));
                else resolve(Object.entries(exchangeInfo['symbols']).filter(([, value]) => value.symbol.endsWith('USDT')
                        && !value.symbol.endsWith('DOWNUSDT')
                        && !value.symbol.endsWith('UPUSDT')
                        && !value.symbol.endsWith('BULLUSDT')
                        && !value.symbol.endsWith('BEARUSDT')
                        && value.status !== 'BREAK'));
            })
        });
    } catch (err) {
        console.error(err)
    }
}

function candlesticks(currencies) {
    try {
        return new Promise(function(resolve, reject) {
            let counter = 0
            Object.entries(currencies).forEach(function([, [, value]]) {
                binance.candlesticks(value.symbol, interval, (error, res) => {
                    if (error !== null)
                        reject(Error(error));
                    else {
                        value.moy = []
                        res.forEach(function(val) {
                            value.moy.push(Number(val[4]))
                        })
                        value.price = value.moy[value.moy.length - 1]

                        let minPrice = (value['filters'].filter(val => val['filterType'] === 'PRICE_FILTER'))[0]
                        let minVolume = (value['filters'].filter(val => val['filterType'] === 'LOT_SIZE'))[0]
                        value.lenPrice = minPrice.minPrice.split('.')[0] === "0" ? (minPrice.minPrice.split('.')[1].split('1')[0] + '1').length : 0
                        value.lenVol = minVolume.minQty.split('.')[0] === "0" ? (minVolume.minQty.split('.')[1].split('1')[0] + '1').length : 0

                        if (++counter === currencies.length) resolve(currencies);
                    }
                }, {limit: limit})
            })
        });
    } catch (err) {
        console.error(err)
    }
}

function noOrders(balances, currencies) {
    try {
        return new Promise(function(resolve,) {
            let counter = 0
            Object.entries(currencies).forEach(([, [, value]]) => {
                if (balances[value['baseAsset']].available * value.price >= 1
                    && value['baseAsset'] !== 'BNB')
                    console.error(value.symbol + ' has units out of order: '
                        + (balances[value['baseAsset']].available * value.price) + '$')

                if (++counter === Object.entries(currencies).length) resolve();
            })
        });
    } catch (err) {
        console.error(err)
    }
}

function changeStopLoss(currencies, open_orders, balances, orders) {
    try {
        return new Promise(function (resolve,) {
            if (open_orders.length > 0) {
                let counter = 0
                Object.entries(open_orders).forEach(function([, _order]) {
                    let curr = currencies.filter(([, val]) => val.symbol === _order.symbol)[0][1]
                    if (balances[curr['baseAsset']].onOrder > 0)
                        changeStopLossSQL(curr, _order, orders).then(function () {
                            if (++counter === Object.entries(open_orders).length) resolve();
                        }, function (err) {
                            console.error(err);
                        });
                })
            }
        })
    } catch (err) {
        console.error(err)
    }
}

function changeStopLossSQL(value, _order, orders) {
    try {
        return new Promise(function(resolve,) {
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
                                    _order.price = _order.price.substr(0, _order.price.split('.')[0].length + (value.lenPrice ? 1 : 0) + value.lenPrice)

                                    _order['origQty'] = _order['origQty'].substr(0, _order['origQty'].split('.')[0].length + (value.lenVol ? 1 : 0) + value.lenVol)

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
                                                orders.push(order(
                                                    value.symbol,
                                                    _order['origQty'],
                                                    _order.price,
                                                    res[0]['price'],
                                                    value.price,
                                                    _order['time'],
                                                    ((value.price - res[0]['price']) / res[0]['price']) * 100
                                                ))
                                                resolve(orders);
                                                conn.end().then();
                                            }).catch(err => {
                                                console.error(err)
                                                conn.end().then();
                                            })
                                        }
                                    })
                                })
                            } else {
                                orders.push(order(
                                    value.symbol,
                                    _order['origQty'],
                                    _order.price,
                                    res[0]['price'],
                                    value.price,
                                    _order['time'],
                                    ((value.price - res[0]['price']) / res[0]['price']) * 100
                                ))
                                resolve(orders);
                            }
                        } else {
                            orders.push(order(
                                value.symbol,
                                _order['origQty'],
                                _order.price,
                                0,
                                value.price,
                                _order['time'],
                                100 - ((_order.price - value.price) / value.price) * 100
                            ))
                            resolve(orders);
                        }
                        conn.end().then();
                    }).catch(err => {
                        conn.end().then();
                        console.error(err);
                    });
                })
        });
    } catch (err) {
        console.error(err)
    }
}

function buySell(currencies, balances, details, new_orders, total) {
    try {
        return new Promise(function(resolve,) {
            let counter = 0
            Object.entries(currencies).forEach(function([, [, value]]) {

                if (Number(balances[value['baseAsset']].onOrder) === 0
                    && Number(balances[value['baseAsset']].available) === 0
                    && Number(balances["USDT"].available) >= (keep_balance + mise)) {

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
                        detail.amprice = Number(((value.price - (value.moy * (100 - a_median) / 100)) / (value.moy * (100 - a_median) / 100)) * 100).toFixed(2)
                        details.push(detail)
                    }

                    if (value.moy * (100 - b_median) / 100 <= value.price &&
                        value.moy * (100 - a_median) / 100 >= value.price &&
                        value.price > 0 && prc >= 10 && prcm >= 10) {

                        let volume = String(mise / value.price)
                        volume = volume.substr(0, volume.split('.')[0].length + (value.lenVol ? 1 : 0) + value.lenVol)

                        let price = String(value.price * security / 100)
                        price = price.substr(0, price.split('.')[0].length + (value.lenPrice ? 1 : 0) + value.lenPrice)

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

                if (++counter === Object.entries(currencies).length) resolve(total);
            });
        });
    } catch (err) {
        console.error(err)
    }
}

(async () => {

    while (1) {
        let balances = []
        let open_orders = []
        let currencies = []
        let orders = []
        let new_orders = []
        let details = []
        let total = 0

        try {

            await balance().then(function(res) {
                balances = res
            }, function(err) {
                console.error(err);
            });

            await openOrders().then(function(res) {
                open_orders = res
            }, function(err) {
                console.error(err);
            });

            await exchangeInfo().then(async function(res) {
                currencies = res
            }, function(err) {
                console.error(err);
            });

            await candlesticks(currencies).then(function(res) {
                currencies = res
            }, function(err) {
                console.error(err);
            });

            await noOrders(balances, currencies).then(null, function(err) {
                console.error(err);
            });

            await changeStopLoss(currencies, open_orders, balances, orders).then(null, function(err) {
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

        await new Promise(res => setTimeout(res, 10000));
    }
})()
