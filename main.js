const secrets = require('./secrets')
const KrakenClient = require('kraken-api');
const kraken       = new KrakenClient(secrets.key(), secrets.secret());

const methods = {
    public : {
        Time  : 'Time', Assets : 'Assets',
        AssetPairs : 'AssetPairs', Ticker : 'Ticker',
        Depth : 'Depth', Trades : 'Trades',
        Spread : 'Spread', OHLC : 'OHLC'
    },
    private : {
        Balance: 'Balance', TradeBalance: 'TradeBalance',
        OpenOrders: 'OpenOrders', ClosedOrders: 'ClosedOrders',
        QueryOrders: 'QueryOrders', TradesHistory: 'TradesHistory',
        QueryTrades: 'QueryTrades', OpenPositions: 'OpenPositions',
        Ledgers: 'Ledgers', QueryLedgers: 'QueryLedgers',
        TradeVolume: 'TradeVolume', AddOrder: 'AddOrder',
        CancelOrder: 'CancelOrder', DepositMethods: 'DepositMethods',
        DepositAddresses: 'DepositAddresses', DepositStatus: 'DepositStatus',
        WithdrawInfo: 'WithdrawInfo', Withdraw: 'Withdraw',
        WithdrawStatus: 'WithdrawStatus', WithdrawCancel: 'WithdrawCancel',
        GetWebSocketsToken: 'GetWebSocketsToken'
    }
};

function average(a) {
    let b = a.length,
        c = 0, i;
    for (i = 0; i < b; i++){
        c += Number(a[i]);
    }
    return c/b;
}

function api(methods, params) {
    return kraken.api(methods, params, null)
}

(async () => {

    const interval = 15// interval value data historic (one week)
    const a_median = 0// after average week - 0 %
    const b_median = 20// before average week - 20 %
    const profit = 10// mise + 10 %
    const mise = 25

    while (1) {

        let currencies = []
        let currencies_open = []
        let orders = []
        let list_names = ''
        let step = 0

        step += 1
        let res = await api(methods.private.Balance)
        if (res['error'].length > 0) console.error(res['error'])
        let balance = res['result']['ZEUR']

        step += 1
        res = await api(methods.private.OpenOrders)
        if (res['error'].length > 0) console.error(res['error'])
        if (res['result'].open !== null) {
            Object.entries(res['result'].open).forEach(([, value]) => {
                currencies_open.push(value)
            })
        }

        step += 1
        res = await api(methods.public.AssetPairs)
        if (res['error'].length > 0) console.error(res['error'])
        Object.entries(res['result']).forEach(([key, value]) => {
            if (value.quote === 'ZEUR') {
                const _currency = Object.create(null);
                _currency.key = key
                _currency.altname = value.altname
                _currency.wsname = value.wsname
                _currency.base = value.base
                _currency.quote = value.quote
                _currency.ordermin = value.ordermin
                _currency.price = 0
                currencies.push(_currency)

                list_names += value.altname + ','
            }
        })

        step += 1
        let res_price = await api(methods.public.Ticker, {pair: list_names.slice(0, -1)})
        if (res_price['error'].length > 0) console.error(res_price['error'])


        for (let i = 0; i < currencies.length; i++) {
            Object.entries(res_price['result']).forEach(([key, value]) => {
                if (currencies[i].key === key) {
                    currencies[i].price = value.a[0]
                }
            });
        }

        for (let i = 0; i < currencies.length; i++) {
            let miser = mise / currencies[i].price < currencies[i].ordermin ?
                currencies[i].ordermin * currencies[i].price : mise

            Object.entries(currencies_open).forEach(([, value]) => {
                if (value['descr'].pair === currencies[i].altname) {
                    const order = Object.create(null);
                    order.currency = value['descr'].pair
                    order.volume = Number(value['vol'])
                    order.start = Number((value['descr'].price - (value['descr'].price * profit / 100)).toFixed(2))
                    order.now = Number(Number((currencies[i].price)).toFixed(2))
                    order.end = Number(value['descr'].price)
                    order.mise = Number(Number(miser).toFixed(2))
                    order.gain_now = Number((currencies[i].price * value['vol']).toFixed(2))
                    order.gain = Number((value['descr'].price * value['vol']).toFixed(2))
                    let date = new Date(value['opentm'] * 1000)
                    order.date = date.getFullYear() + '-' +
                        ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
                        ('0' + date.getDate()).slice(-2) + ' ' +
                        ('0' + date.getHours()).slice(-2) + ':' +
                        ('0' + date.getMinutes()).slice(-2) + ':' +
                        ('0' + date.getSeconds()).slice(-2)
                    orders.push(order)

                    currencies = currencies.filter(item => item !== currencies[i])
                }
            })

            if (balance >= miser) {
                new Promise(res => setTimeout(res, 100));

                step += 1
                res = await api(methods.public.OHLC, {pair: currencies[i].altname, interval: interval})
                if (res['error'].length > 0) console.error(res['error'])

                let moy = []
                Object.entries(res['result'][currencies[i].key]).forEach(([, value]) => {
                    moy.push(value[1])
                })
                moy = average(moy)

                if (moy * (100 - b_median) / 100 <= currencies[i].price &&
                    moy * (100 + a_median) / 100 >= currencies[i].price &&
                    currencies[i].price > 0) {

                    let volume = miser / currencies[i].price
                    let close_price = (Number(currencies[i].price) * profit / 100) + Number(currencies[i].price)

                    step += 1
                    res = await api(methods.private.AddOrder, {
                        'pair': currencies[i].key, 'type': 'buy',
                        'ordertype': 'market', 'volume': volume, 'close[type]': 'sell',
                        'close[ordertype]': 'take-profit',
                        'close[price]': close_price
                    })
                    if (res['error'].length > 0) console.error(res['error'])

                    balance -= miser

                    miser = Math.round((mise / currencies[i].price < currencies[i].ordermin ?
                        currencies[i].ordermin * currencies[i].price : mise) * 10000) / 10000

                    volume = Math.round((miser / currencies[i].price) * 10000) / 10000

                    close_price = Math.round(((Number(currencies[i].price) * profit / 100) + Number(currencies[i].price)) * 10000) / 10000

                    let plus_value = Math.round((((Number(currencies[i].price) * profit / 100) + Number(currencies[i].price)) *
                        (Number(miser) / Number(currencies[i].price) < Number(currencies[i].ordermin) ?
                            Number(currencies[i].ordermin) : Number(miser) / Number(currencies[i].price))) * 10000) / 10000

                    const order = Object.create(null);
                    order.currency = currencies[i].key
                    order.volume = volume
                    order.start = currencies[i].price
                    order.now = currencies[i].price
                    order.end = close_price
                    order.mise = miser
                    order.gain_now = plus_value
                    order.gain = plus_value
                    let date = new Date()
                    order.date = date.getUTCFullYear() + '-' +
                        ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
                        ('0' + date.getDate()).slice(-2) + ' ' +
                        ('0' + date.getHours()).slice(-2) + ':' +
                        ('0' + date.getMinutes()).slice(-2) + ':' +
                        ('0' + date.getSeconds()).slice(-2)
                    orders.push(order)
                }
            }
        }

        console.table(orders)
        console.table({'balance': Number(balance), 'step': step})

        await new Promise(res => setTimeout(res, 30000));
    }
})();