const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./lib/func');

const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: binSecret.key(),
    APISECRET: binSecret.secret()
});

// get balance of account
function getBalances() {
    binance.balance().then(balances => {
        getOpenOrders(balances)
    }).catch(error => console.error(error)
    ).finally(() => new Promise(res => setTimeout(res, config.refresh())).finally(() => getBalances()))
}

// get open order
function getOpenOrders(balances) {
    binance.openOrders().then(openOrders => {
        getCurrencies(balances, openOrders)
    }).catch(error => console.error(error))
}

// get currencies available
function getCurrencies(balances, openOrders) {
    binance.exchangeInfo().then(exchangeInfo => {
        let total = Number(balances[config.baseMoney()].available) + Number(balances[config.baseMoney()].onOrder),
            counter = 0, currencies = []

        Object.entries(exchangeInfo['symbols']).forEach(([, value]) => {
            if (value.symbol.endsWith(config.baseMoney())
                && !value.symbol.endsWith('DOWN' + config.baseMoney())
                && !value.symbol.endsWith('UP' + config.baseMoney())
                && !value.symbol.endsWith('BULL' + config.baseMoney())
                && !value.symbol.endsWith('BEAR' + config.baseMoney())
                && value.status !== 'BREAK') {

                getHistories(value).then(value => {
                    if (value !== undefined) {
                        total += getTotal(value, balances)
                        getNoOrders(value, balances)
                        currencies.push({symbol: value.symbol, price: value.price, lenVol: value.lenVol,
                            lenPrice: value.lenPrice, baseAsset: value.baseAsset, moy: value.moy})
                    }

                    if (++counter === exchangeInfo['symbols'].length)
                        prepareBuy(currencies, balances, openOrders, total)
                }).catch(error => console.error(error))
            } else if (++counter === exchangeInfo['symbols'].length)
                prepareBuy(currencies, balances, openOrders, total)
        })
    }).catch(error => console.error(error))
}

// get history per currency
function getHistories(value) {
    return binance.candlesticks(value.symbol, config.interval()[0], null, {limit: config.interval()[1]}).then(res => {
        value.moy = []
        res.forEach(function (val) {
            value.moy.push(Number(val[4]))
        })
        value.price = value.moy[value.moy.length - 1]

        let minPrice = (value['filters'].filter(val => val['filterType'] === 'PRICE_FILTER'))[0]
        let minVolume = (value['filters'].filter(val => val['filterType'] === 'LOT_SIZE'))[0]
        value.lenPrice = minPrice.minPrice.split('.')[0] === "0"
            ? (minPrice.minPrice.split('.')[1].split('1')[0] + '1').length : 0
        value.lenVol = minVolume.minQty.split('.')[0] === "0"
            ? (minVolume.minQty.split('.')[1].split('1')[0] + '1').length : 0

        return value
    }).catch(error => {
        console.error(error)
    })
}

function getTotal(value, balances) {
    return value.price * Number(balances[value['baseAsset']].available)
        + value.price * Number(balances[value['baseAsset']].onOrder)
}

// get currency without order
function getNoOrders(value, balances) {
    if (balances[value['baseAsset']].available * value.price >= config.noOrder()
        && value['baseAsset'] !== config.feeMoney())
        console.error(value.symbol + ' has units out of order: '
            + (balances[value['baseAsset']].available * value.price) + config.baseSymbol())

    if (value.symbol === config.feeMoney() + config.baseMoney())
        balances[config.feeMoney()].available *= value.price
}

// buy currency
function buyLimit(currenciesLen, curr, balances, orders, total, open, now, want, mise) {
    try {
        let counter = 0, new_orders = []
        Object.entries(curr).forEach(function ([, value]) {

            let volume = String(mise / value.price)
            volume = volume.substr(0, volume.split('.')[0].length
                + (value.lenVol ? 1 : 0) + value.lenVol)

            let price = String(value.price * (config.profit() / 100 + 1))
            price = price.substr(0, price.split('.')[0].length
                + (value.lenPrice ? 1 : 0) + value.lenPrice)

            value.price = String(value.price * volume)
            value.price = value.price.substr(0, value.price.split('.')[0].length
                + (value.lenPrice ? 1 : 0) + value.lenPrice)

            if (balances[config.feeMoney()].available > (value.price * config.feeValue() / 100)) {
                open += Number(value.price)
                now += Number(value.price)
                want += Number(price * volume)

                binance.marketBuy(value.symbol, volume, (error,) => {
                    if (error !== null) {
                        let responseJson = JSON.parse(error.body)
                        console.error(value.symbol + " [" + responseJson.code + "]: " + responseJson["msg"] + " " + price
                            + " " + volume)
                    } else {
                        binance.sell(value.symbol, volume, price, {type: 'LIMIT'}, (error,) => {
                            if (error !== null) {
                                let responseJson = JSON.parse(error.body)
                                console.error(value.symbol + " [" + responseJson.code + "]: "
                                    + responseJson["msg"] + " " + price + " " + volume)
                            } else {
                                new_orders.push(func.order(
                                    value.symbol,
                                    volume,
                                    price * volume,
                                    value.price,
                                    value.price,
                                    Date.now(),
                                    0
                                ))

                                balances[config.baseMoney()].available -= mise
                                balances[config.feeMoney()].available -= value.price * config.feeValue() / 100

                                if (++counter === curr.length)
                                    getOutput(currenciesLen, curr.length, new_orders, balances, orders, total, open, now, want)
                            }
                        })
                    }
                })
            } else {
                getOutput(currenciesLen, curr.length, new_orders, balances, orders, total, open, now, want)
                console.error("Veuillez acheter du " + config.feeMoney() + " pour les frais")
            }
        });
    } catch (err) {
        console.error(err)
    }
}

// Remove cryptocurrencies that do not match the purchase condition
function prepareBuy(currencies, balances, openOrders, total) {
    try {
        let curr = [], orders = []
        let counter = 0, open = 0, now = 0, want = 0, mise = total * config.mise() / 100;

        Object.entries(currencies).forEach(function ([, value]) {

            let order = Object.entries(openOrders).filter(([, val]) => val.symbol === value.symbol)[0]
            if (order !== undefined) {
                order = order[1]

                let volume = String(order['origQty'])
                volume = volume.substr(0, volume.split('.')[0].length
                    + (value.lenVol ? 1 : 0) + value.lenVol)

                let openValue = String(order.price / (config.profit() / 100 + 1) * order['origQty'])
                openValue = openValue.substr(0, openValue.split('.')[0].length
                    + (value.lenPrice ? 1 : 0) + value.lenPrice)

                let nowValue = String(value.price * order['origQty'])
                nowValue = nowValue.substr(0, nowValue.split('.')[0].length
                    + (value.lenPrice ? 1 : 0) + value.lenPrice)

                let wantValue = String(order.price * order['origQty'])
                wantValue = wantValue.substr(0, wantValue.split('.')[0].length
                    + (value.lenPrice ? 1 : 0) + value.lenPrice)

                open += Number(openValue)
                now += Number(nowValue)
                want += Number(wantValue)

                orders.push(func.order(
                    value.symbol,
                    volume,
                    wantValue,
                    openValue,
                    nowValue,
                    order['time'],
                    (nowValue / openValue * 100) - 100
                ))
            }
            else if (Number(balances[value['baseAsset']].onOrder) === 0
                && Number(balances[value['baseAsset']].available) === 0) {

                let max = Math.max.apply(null, value.moy)
                value.moy = func.lAvg(value.moy)
                let prc = ((max - value.moy) / value.moy) * 100

                if (value.moy * (100 - config.median()[1]) / 100 <= value.price
                    && value.moy * (100 - config.median()[0]) / 100 >= value.price
                    && value.price > 0 && prc >= config.prc()) {

                    value.am_price = Number((((value.price - (value.moy * (100 - config.median()[0]) / 100))
                        / (value.moy * (100 - config.median()[0]) / 100)) * 100).toFixed(2))

                    curr.push({symbol: value.symbol, price: value.price, lenVol: value.lenVol, lenPrice: value.lenPrice,
                        am_price: value.am_price})
                }
            }

            if (++counter === currencies.length) {
                let nbMise = Number(String((Number(balances[config.baseMoney()].available)
                    - config.keep_balance()) / mise).split('.')[0])
                if (nbMise > 0 && (!config.onlyShort() || Number((curr.length / currencies.length * 100)
                    .toFixed(0)) >= config.marketPrc())) {
                    curr = curr.sort((a, b) => a.am_price - b.am_price).slice(0, nbMise <= 29 ? nbMise : 29)
                    if (curr.length > 0)
                        buyLimit(currencies.length, curr, balances, orders, total, open, now, want, mise)
                    else getOutput(currencies.length, curr.length, [], balances, orders, total, open, now, want)
                } else getOutput(currencies.length, curr.length, [], balances, orders, total, open, now, want)
            }
        });
    } catch (err) {
        console.error(err)
    }
}

// Return status of orders, balances and cryptos
function getOutput(currenciesLen, currLen, new_orders, balances, orders, total, open, now, want) {

    const stateCurrencies = {
        [config.colCrypto()[0]]: {
            [config.colCrypto()[1]]: currLen, [config.colCrypto()[2]]: currenciesLen,
            '%': Number((currLen / currenciesLen * 100).toFixed(0)),
            [config.colCrypto()[3]]: config.colCrypto()[4] + ' '
            + (Number((currLen / currenciesLen * 100).toFixed(0)) >= config.marketPrc() ? config.colCrypto()[5]
                : config.colCrypto()[6])
        }
    }

    const stateBalance = {
        ['Trades (' + config.baseSymbol() + ')']: {
            [config.colResume()[0]]: Number((Number(open)).toFixed(2)),
            [config.colResume()[1]]: Number((Number(now)).toFixed(2)),
            [config.colResume()[2]]: Number((Number(want)).toFixed(2))
        },
        [config.baseMoney() + ' (' + config.baseSymbol() + ')']: {
            [config.colResume()[0]]: Number(Number(balances[config.baseMoney()].available).toFixed(2)),
            [config.colResume()[1]]: Number(Number(balances[config.baseMoney()].available).toFixed(2)),
            [config.colResume()[2]]: Number(Number(balances[config.baseMoney()].available).toFixed(2))
        },
        [config.feeMoney() + ' (' + config.baseSymbol() + ')']: {
            [config.colResume()[0]]: Number(Number(balances[config.feeMoney()].available).toFixed(2)),
            [config.colResume()[1]]: Number(Number(balances[config.feeMoney()].available).toFixed(2)),
            [config.colResume()[2]]: Number(Number(balances[config.feeMoney()].available).toFixed(2))
        },
        ['Total (' + config.baseSymbol() + ')']: {
            [config.colResume()[0]]: Number((Number(open) + Number(balances[config.baseMoney()].available)
                + Number(balances[config.feeMoney()].available)).toFixed(2)),
            [config.colResume()[1]]: Number((Number(now) + Number(balances[config.baseMoney()].available)
                + Number(balances[config.feeMoney()].available)).toFixed(2)),
            [config.colResume()[2]]: Number((Number(want) + Number(balances[config.baseMoney()].available)
                + Number(balances[config.feeMoney()].available)).toFixed(2))
        }
    }

    if (orders.length > 0) console.table(orders.sort((a, b) => b.plusValue - a.plusValue))
    if (new_orders.length > 0) console.table(new_orders)
    console.table(stateCurrencies)
    console.table(stateBalance)
}

// Start bot
getBalances();
