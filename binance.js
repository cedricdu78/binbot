const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./lib/func');

const Binance = require('node-binance-api');

/*
┌────────────┬───────────┬───────┬────┬──────────────────┐
│  (index)   │ Available │ Total │ %  │      Status      │
├────────────┼───────────┼───────┼────┼──────────────────┤
│ Currencies │    39     │  209  │ 19 │ 'Market bullish' │
└────────────┴───────────┴───────┴────┴──────────────────┘
┌────────────┬─────────┬─────────┬─────────┐
│  (index)   │ Placed  │ Current │ Target  │
├────────────┼─────────┼─────────┼─────────┤
│ Trades ($) │ 5908.33 │ 4890.15 │ 6499.17 │
│  USDT ($)  │ 177.23  │ 177.23  │ 177.23  │
│  BNB ($)   │  21.86  │  21.86  │  21.86  │
│ Total ($)  │ 6107.42 │ 5089.23 │ 6698.26 │
└────────────┴─────────┴─────────┴─────────┘
 */

let histories = []

function getBalances() {

    const binance = new Binance().options({
        APIKEY: binSecret.key(),
        APISECRET: binSecret.secret()
    });

    binance.balance().then(balances => {
        binance.openOrders().then(openOrders => {
            const USD = Number(balances[config.baseMoney()].available) + Number(balances[config.baseMoney()].onOrder)
            let resume = {total : USD, inOrder: 0}

            binance.bookTickers().then(bookTickers => {

                Object.entries(bookTickers).forEach(([key, value]) => {
                    if (key.endsWith(config.baseMoney())
                        && !key.endsWith('DOWN' + config.baseMoney())
                        && !key.endsWith('UP' + config.baseMoney())
                        && !key.endsWith('BULL' + config.baseMoney())
                        && !key.endsWith('BEAR' + config.baseMoney())) {

                        resume.total += value.ask * (Number(balances[key.replace('USDT', '')].available)
                            + Number(balances[key.replace('USDT', '')].onOrder))
                    }
                })

                let mise = resume.total * 4 / 100
                let nbMise = USD / mise
                let orders = []

                Object.entries(openOrders).forEach(([, order]) => {
                    let nowValue = Number((bookTickers[order.symbol].ask * order['origQty']).toFixed(2))
                    let openValue = Number((order.price / (config.profit() / 100 + 1) * order['origQty']).toFixed(2))
                    let wantValue = Number((order.price * order['origQty']).toFixed(2))
                    orders.push(func.order(
                        order.symbol,
                        order['origQty'],
                        wantValue,
                        openValue,
                        nowValue,
                        order['time'],
                        (nowValue / openValue * 100) - 100
                    ))

                    resume.inOrder += Number(order.price * order['origQty'])
                })

                if (orders.length > 0) console.table(orders.sort((a, b) => b.plusValue - a.plusValue))
                console.table({
                    status: {
                        Mise: Number(mise.toFixed(2)),
                        BNB: Number((balances[config.feeMoney()].available * bookTickers[config.feeMoney() + config.baseMoney()].ask).toFixed(2)),
                        USD: Number(USD.toFixed(2)),
                        InOrder: Number(resume.inOrder.toFixed(2)),
                        Total: Number(resume.total.toFixed(2))
                    }
                })

                binance.exchangeInfo().then(exchangeInfo => {
                    Object.entries(exchangeInfo['symbols']).forEach(([, value]) => {
                        if (value.symbol.endsWith(config.baseMoney())
                            && !value.symbol.endsWith('DOWN' + config.baseMoney())
                            && !value.symbol.endsWith('UP' + config.baseMoney())
                            && !value.symbol.endsWith('BULL' + config.baseMoney())
                            && !value.symbol.endsWith('BEAR' + config.baseMoney())
                            && value.status !== 'BREAK') {

                            let startDate = new Date()
                            let endDate = new Date()
                            startDate.setDate(startDate.getDate() - 7)

                            if (histories[value.symbol] !== undefined)
                                startDate = new Date(histories[value.symbol][histories[value.symbol].length - 1][0])

                            binance.candlesticks(value.symbol, config.interval()[0], null, {
                                startTime: startDate.getTime(), endTime: endDate.getTime(), limit: config.interval()[1]
                            }).then(res => {
                                if (histories[value.symbol] !== undefined) {
                                    for (let i = 0; i < res.length; i++) {
                                        i === 0 ? histories[value.symbol].pop() : histories[value.symbol].shift()
                                    }

                                    res.forEach(v => {
                                        histories[value.symbol].push(v)
                                    })
                                } else histories[value.symbol] = res

                                if (histories[value.symbol].length > 650) {
                                    value.moy = []
                                    histories[value.symbol].forEach(function (val) {
                                        value.moy.push(Number(val[4]))
                                    })
                                    value.price = value.moy[value.moy.length - 1]

                                    let minPrice = (value['filters'].filter(val => val['filterType'] === 'PRICE_FILTER'))[0]
                                    let minVolume = (value['filters'].filter(val => val['filterType'] === 'LOT_SIZE'))[0]
                                    value.lenPrice = minPrice.minPrice.split('.')[0] === "0"
                                        ? (minPrice.minPrice.split('.')[1].split('1')[0] + '1').length : 0
                                    value.lenVol = minVolume.minQty.split('.')[0] === "0"
                                        ? (minVolume.minQty.split('.')[1].split('1')[0] + '1').length : 0

                                    if (Number(balances[value['baseAsset']].onOrder) === 0
                                        && Number(balances[value['baseAsset']].available) === 0) {

                                        let max = Math.max.apply(null, value.moy)
                                        value.moy = func.lAvg(value.moy)
                                        let prc = ((max - value.moy) / value.moy) * 100

                                        if (value.moy * (100 - config.median()[1]) / 100 <= value.price
                                            && value.moy * (100 - config.median()[0]) / 100 >= value.price
                                            && value.price > 0 && prc >= config.prc() && nbMise >= 1 && nbMise--) {

                                            let volume = String(mise / value.price)
                                            volume = volume.substr(0, volume.split('.')[0].length
                                                + (value.lenVol ? 1 : 0) + value.lenVol)

                                            let price = String(value.price * (config.profit() / 100 + 1))
                                            price = price.substr(0, price.split('.')[0].length
                                                + (value.lenPrice ? 1 : 0) + value.lenPrice)

                                            value.price = String(value.price * volume)
                                            value.price = value.price.substr(0, value.price.split('.')[0].length
                                                + (value.lenPrice ? 1 : 0) + value.lenPrice)

                                            console.table({
                                                Buying: func.order(
                                                    value.symbol,
                                                    volume,
                                                    price * volume,
                                                    value.price,
                                                    value.price,
                                                    Date.now(),
                                                    0
                                                )
                                            })

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
                                                            balances[config.baseMoney()].available -= mise
                                                            balances[config.feeMoney()].available -= value.price * config.feeValue() / 100
                                                        }
                                                    })
                                                }
                                            })
                                        }
                                    }
                                }
                            })
                        }
                    })
                })
            })
        })
    }).finally(() => {
        new Promise(res => setTimeout(res, config.refresh())).finally(() => getBalances())
    })
}

new Promise(res => setTimeout(res, config.refresh())).finally(() => getBalances())
