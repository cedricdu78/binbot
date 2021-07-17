const Client = require('node-rest-client').Client;
const client = new Client();

const URL = "http://127.0.0.1:8080"

class Binance {
    async accountInfo() {
        let response = {}
        await new Promise((resolve,) => {
            client.get(URL + "/accountInfo", function (data,) {
                response = data
                resolve();
            });
        })
        return response
    };

    async openOrders() {
        let response = {}
        await new Promise((resolve,) => {
            client.get(URL + "/openOrders", function (data,) {
                response = data
                resolve();
            });
        })
        return response
    };

    async exchangeInfo() {
        let response = {}
        await new Promise((resolve,) => {
            client.get(URL + "/exchangeInfo", function (data,) {
                response = data
                resolve();
            });
        })
        return response
    };

    async prices() {
        let response = {}
        await new Promise((resolve,) => {
            client.get(URL + "/prices", function (data,) {
                response = data
                resolve();
            });
        })
        return response
    };

    async candles(obj) {
        let response = {}
        await new Promise((resolve,) => {
            client.get(URL + "/candles"
                + "?symbol=" + obj.symbol + "&interval=" + obj.interval + "&startTime=" + obj.startTime
                + "&endTime=" + obj.endTime + "&limit=" + obj.limit
                , function (data,) {
                response = data
                resolve();
            });
        })
        return response
    };
}

module.exports = Binance