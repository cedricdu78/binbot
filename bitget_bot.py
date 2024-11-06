#!/bin/python3

api_key = ''
api_secret = ''
api_passphrase = ''

config = {
    'baseMoney': 'USDT',
    'feeMoney': 'BGB',
    'mise': 4,
    'minimalAmount': 0,
    'median': [-10, 40],
    'prc': 10,
    'profit': 15,
    'stopLoss': 1
}

import sys, os
import datetime
from time import sleep
from multiprocessing import Pool
import statistics
from rich import print
import traceback
from prettytable import PrettyTable

import bitget.bitget_api as baseApi
from binance.spot import Spot as binanceApi

import bitget.v2.spot.order_api as spotOrderApi

nextBuy = datetime.datetime.now()

class binbot():

    baseApi = baseApi.BitgetApi(api_key, api_secret, api_passphrase)
    binanceApi = binanceApi()

    endTime = datetime.datetime.timestamp(datetime.datetime.now())
    startTime = datetime.datetime.timestamp(datetime.datetime.now() - datetime.timedelta(days=7))

    def pretty_table(self, lst):
        table = PrettyTable()
        table.max_width = 20
        table.field_names = lst[0].keys()
        for dico in lst:
            table.add_row(dico.values())
        print(table)

    def request_post_api(self, uri, params={}):
        sys.stdout = open(os.devnull, 'w')
        response = self.baseApi.post(uri, params)
        #print(response)
        sys.stdout = sys.__stdout__
        return response['data']

    def request_api(self, uri, params={}):
        sys.stdout = open(os.devnull, 'w')
        response = self.baseApi.get(uri, params)
        #print(response)
        sys.stdout = sys.__stdout__
        return response['data']

    def download_candles(self, currency):
        history = self.request_api('/api/v2/spot/market/candles', { 
            'symbol': currency['symbol'],
            'granularity': '15min',
            'startTime': int(self.startTime) * 1000,
            'endTime': int(self.endTime) * 1000,
            'limit': '680'
        })
        sleep(1)
        return { 'symbol': currency['symbol'], 'candles': history }

    def main(self):

        global nextBuy

        balances = self.request_api('/api/v2/spot/account/assets')
        tickers = self.request_api('/api/v2/spot/market/tickers')
        symbols = self.request_api('/api/v2/spot/public/symbols')
        symbols_binance = [symbol['symbol'] for symbol in self.binanceApi.book_ticker()]
        orders = self.request_api('/api/v2/spot/trade/unfilled-orders', {'tpslType': 'tpsl'})

        resume = { 'mise': 0, 'placed': 0, 'current': 0, 'target': 0, 'available': 0, 'availableFee': 0, 'total': 0, 'nextBuy': nextBuy }

        resume['available'] = float([b for b in balances if b['coin'] == config['baseMoney']][0]['available'])

        assets_unorder = []
        for asset in [bal for bal in balances if bal['coin'] != config['baseMoney']]:

            ticker = [t for t in tickers if t['symbol'] == asset['coin'] + config['baseMoney']]

            if len(ticker) == 0 and float(asset['available']) > 0 and asset['coin'] != config['feeMoney']:
                assets_unorder.append({'asset': asset['coin'], 'available': float(asset['available']), 'USDT': 0 })
                continue

            asset['USDT'] = (float(asset['available']) + float(asset['frozen'])) * float(ticker[0]['lastPr'])

            if asset['coin'] == config['feeMoney']:
                resume['availableFee'] = float(asset['available']) * float(ticker[0]['lastPr'])
                continue

            if float(asset['available']) > 0 and asset['coin'] != config['feeMoney']:
                assets_unorder.append({
                    'asset': asset['coin'], 'available': float(asset['available']), 
                    'USDT': round(float(asset['available']) * float(ticker[0]['lastPr']), 2)
                })

            resume['current'] += asset['USDT']

        myOrders = []
        for order in orders:
            #order_info = self.request_api('/api/v2/spot/trade/orderInfo', { 'orderId': int(order['orderId']) })
            # resume['placed'] += 0
            # resume['target'] += 0

            myOrders.append({ 
                'symbol': order['symbol'], 
                'volume': float(order['size']),
                'price': round(float(order['size']) * float([t for t in tickers if t['symbol'] == order['symbol']][0]['lastPr']), 2),
                'date': datetime.datetime.fromtimestamp(int(order['cTime']) / 1000)
            })

        resume['total'] = resume['available'] + resume['availableFee'] + resume['current']
        resume['mise'] = resume['total'] * config['mise'] / 100

        if (resume['total'] < config['minimalAmount']):
            print("exit because you not have minimal amount.")
            exit(1)

        newOrders = []
        if datetime.datetime.now() > nextBuy:

            # Filter by asset have it
            currencies = [symbol for symbol in symbols if not any([asset['USDT'] for asset in balances if asset['coin'] + config['baseMoney'] == symbol['symbol'] and asset['USDT'] >= 1])]

            # Filter by order have it
            currencies = [symbol for symbol in currencies if len([order for order in orders if order['symbol'] == symbol['symbol']]) == 0]

            # Filter by base money
            currencies = [currency for currency in currencies if currency['quoteCoin'] == config['baseMoney'] and currency['status'] == 'online']

            # Filter by binance
            currencies = [currency for currency in currencies if currency['symbol'] in symbols_binance]

            pool = Pool(processes=20)
            histories = pool.map(self.download_candles, currencies)
            pool.close()
            pool.join()

            histories = [history for history in histories if len(history['candles']) >= 600]

            # Filter by histories
            currencies = [currency for currency in currencies if currency['symbol'] in [history['symbol'] for history in histories]]

            for currency in currencies:

                lAvg = [float(candle[4]) for history in histories if history['symbol'] == currency['symbol'] for candle in history['candles']]
                currency['avg'] = statistics.mean(lAvg)
                currency['max'] = max(lAvg)

                currency['price'] = float([t for t in tickers if t['symbol'] == currency['symbol']][0]['lastPr'])

                currency['am_price'] = ((currency['price'] - (currency['avg'] * (100 - config['median'][0]) / 100))
                    / (currency['avg'] * (100 - config['median'][0]) / 100)) * 100

            # Filter by histories
            currencies = [currency for currency in currencies if currency['price'] > 0 \
                    and currency['avg'] * (100 - config['median'][0]) / 100 >= currency['price'] \
                    and currency['avg'] * (100 - config['median'][1]) / 100 <= currency['price'] \
                    and (((currency['max'] - currency['avg']) / currency['avg']) * 100) >= config['prc'] \
                ]

            resume['length'] = len(currencies)

            currencies = sorted(currencies, key=lambda x: x['am_price'])
            currencies = currencies[:int(resume['available'] / resume['mise'])]

            for currency in currencies:
                sellPrice = round(currency['price'] * (config['profit'] / 100 + 1), int(currency['pricePrecision']))
                stopLoss = round(currency['price'] * (1 - config['stopLoss'] / 100), int(currency['pricePrecision']))
                volume = round(resume['mise'] / currency['price'], int(currency['quantityPrecision']))

                place_order = self.request_post_api('/api/v2/spot/trade/place-order', {
                    'symbol': currency['symbol'],
                    'side': 'buy',
                    'orderType': 'market',
                    'size': round(resume['mise'], int(currency['pricePrecision'])),
                    'tpslType': 'normal',
                    'presetTakeProfitPrice': sellPrice,
                    'presetStopLossPrice': stopLoss
                })

                newOrders.append({
                    'symbol': currency['symbol'], 
                    'volume': volume, 
                    'price': currency['price'], 
                    'sellPrice': sellPrice * volume, 
                    'mise': resume['mise'],
                    'date': datetime.datetime.now()
                })

                resume['available'] -= resume['mise']
                #resume['availableFee'] -= Number(e2.data.fee)
                resume['placed'] += resume['mise']
                resume['current'] += resume['mise']
                resume['target'] += sellPrice * volume

            nextBuy = nextBuy + datetime.timedelta(minutes=15)

        print('\nList orders:')
        self.pretty_table(sorted(myOrders, key=lambda d: d['price'], reverse=True))

        if len(newOrders) > 0:
            print('\nNew orders:')
            self.pretty_table(newOrders)

        if len(assets_unorder) > 0:
            print('\nAssets without order:')
            self.pretty_table(assets_unorder)

        print('\nAccount:')
        resume['mise'] = round(resume['mise'], 2)
        resume['placed'] = round(resume['placed'], 2)
        resume['current'] = round(resume['current'], 2)
        resume['target'] = round(resume['target'], 2)
        resume['available'] = round(resume['available'], 2)
        resume['availableFee'] = round(resume['availableFee'], 2)
        resume['total'] = round(resume['total'], 2)

        self.pretty_table([resume])

#binbot().main()

while True:
    sleep(3)
    try: binbot().main()
    except Exception as error:
        traceback.print_exc()
    sleep(20)
