const secrets = require('./secrets')
const KrakenClient = require('kraken-api');
const kraken       = new KrakenClient(secrets.key(), secrets.secret());

let app = require("express")();
let http = require("http").Server(app);
let io = require("socket.io")(http, {
    cors: {
	    origin: "*",
    }
});

http.listen(8000, '127.0.0.1', function () {
  console.log("listening in port 8000");
});

let currencies_api = []
let orders_api = []
let balances_api = []
let state_bot = false

io.on('connection', (socket) => {
    socket.on('balances', (callback) => {
        callback(balances_api)
    })
    socket.on('balances_euros', (callback) => {
        callback(Number(balances_api["ZEUR"]).toFixed(2))
    })
    socket.on('orders', (callback) => {
        callback(orders_api)
    })
    socket.on('currencies', (callback) => {
        callback(currencies_api)
    })
    socket.on('state_bot', (callback) => {
        callback(state_bot)
    })
    socket.on('start_bot', (callback) => {
        state_bot = true
        callback(state_bot)
    })
    socket.on('stop_bot', (callback) => {
        state_bot = false
        callback(state_bot)
    })
});

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
    const keep_balance = 0

    const currencies_blacklist = [
        "USDTEUR",
        "USDCEUR",
        "DAIEUR",
        "PAXGEUR",
        "TBTCEUR",
        "YFIEUR"
    ]

    while (1) {

        try {
            let currencies = []
            let orders = []
            let currencies_open = []
            let new_orders = []
            let list_names = ''

            let res = await api(methods.private.Balance)
            if (res['error'].length > 0) console.error(res['error'])
            balances_api = res['result']
            let balance = balances_api['ZEUR']

            res = await api(methods.private.OpenOrders)
            if (res['error'].length > 0) console.error(res['error'])
            if (res['result'].open !== null) {
                Object.entries(res['result'].open).forEach(([, value]) => {
                    currencies_open.push(value)
                })
            }

            res = await api(methods.public.AssetPairs)
            if (res['error'].length > 0) console.error(res['error'])
            Object.entries(res['result']).forEach(([key, value]) => {
                if (value.quote === 'ZEUR' && !(currencies_blacklist.indexOf(value.altname) > -1)) {
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

            res = await api(methods.public.Ticker, {pair: list_names.slice(0, -1)})
            if (res['error'].length > 0) console.error(res['error'])
            for (let i = 0; i < currencies.length; i++) {
                Object.entries(res['result']).forEach(([key, value]) => {
                    if (currencies[i].key === key) {
                        currencies[i].price = value.a[0]
                    }
                });
            }

            currencies_api = currencies

            for (let i = 0; i < currencies_open.length; i++) {

                Object.entries(currencies).forEach(([, value]) => {
                    if (currencies_open[i]['descr'].pair === value.altname) {
                        const order = Object.create(null);
                        order.currency = value.wsname
                        order.volume = Number(currencies_open[i]['vol'])
                        order.start = Number((currencies_open[i]['descr'].price - (currencies_open[i]['descr'].price * profit / 100)).toFixed(3))
                        order.now = Number(Number((value.price)).toFixed(3))
                        order.end = Number(currencies_open[i]['descr'].price)
                        order.mise = Number(Number(order.start * order.volume).toFixed(3))
                        order.gain_now = Number((value.price * currencies_open[i]['vol']).toFixed(3))
                        order.gain_end = Number((currencies_open[i]['descr'].price * currencies_open[i]['vol']).toFixed(3))
                        let date = new Date(currencies_open[i]['opentm'] * 1000)
                        order.date = date.getFullYear() + '-' +
                            ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
                            ('0' + date.getDate()).slice(-2) + ' ' +
                            ('0' + date.getHours()).slice(-2) + ':' +
                            ('0' + date.getMinutes()).slice(-2) + ':' +
                            ('0' + date.getSeconds()).slice(-2)
                        order.success = Number((100 * order.gain_now / order.gain_end * 0.992).toFixed(2))
                        orders.push(order)
                    }
                })
            }

            orders_api = orders

            currencies = currencies.filter(item => item.price !== 0)

            Object.entries(currencies_open).forEach(([, value]) => {
                currencies = currencies.filter(item => item.altname !== value["descr"].pair)
            })

            for (let i = 0; i < currencies.length; i++) {
                let miser = mise / currencies[i].price < currencies[i].ordermin ?
                    currencies[i].ordermin * currencies[i].price : mise
                if (balance >= (keep_balance + miser) && state_bot) {
                    new Promise(res => setTimeout(res, 100));

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

                        res = await api(methods.private.AddOrder, {
                             'pair': currencies[i].key, 'type': 'buy',
                             'ordertype': 'market', 'volume': volume, 'close[type]': 'sell',
                             'close[ordertype]': 'take-profit',
                             'close[price]': close_price
                        })
                        if (res['error'].length > 0) console.error(res['error'])

                        balance -= miser

                        miser = Math.round((mise / currencies[i].price < currencies[i].ordermin ?
                            currencies[i].ordermin * currencies[i].price : mise) * 100000) / 100000

                        volume = Math.round((miser / currencies[i].price) * 100000) / 100000

                        close_price = Math.round(((Number(currencies[i].price) * profit / 100) + Number(currencies[i].price)) * 100000) / 100000

                        let plus_value = Math.round((((Number(currencies[i].price) * profit / 100) + Number(currencies[i].price)) *
                            (Number(miser) / Number(currencies[i].price) < Number(currencies[i].ordermin) ?
                                Number(currencies[i].ordermin) : Number(miser) / Number(currencies[i].price))) * 100000) / 100000

                        const order = Object.create(null);
                        order.currency = currencies[i].wsname
                        order.volume = volume
                        order.start = Number(currencies[i].price)
                        order.now = Number(currencies[i].price)
                        order.end = close_price
                        order.mise = miser
                        order.gain_now = miser
                        order.gain_end = plus_value
                        let date = new Date()
                        order.date = date.getUTCFullYear() + '-' +
                            ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
                            ('0' + date.getDate()).slice(-2) + ' ' +
                            ('0' + date.getHours()).slice(-2) + ':' +
                            ('0' + date.getMinutes()).slice(-2) + ':' +
                            ('0' + date.getSeconds()).slice(-2)
                        order.success = Number((100 * order.gain_now / order.gain_end).toFixed(2))
                        new_orders.push(order)
                    }
                }
            }

            if (orders.length > 0) console.table(orders.sort((a , b) => b.success - a.success))
            if (new_orders.length > 0) console.table(new_orders)
            console.table({'balance': Number(Number(balance).toFixed(2))})

            await new Promise(res => setTimeout(res, 30000));
        } catch (err) {
            console.error(err)
        }
    }
})();
