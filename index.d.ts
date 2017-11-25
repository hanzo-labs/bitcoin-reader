declare var axios: any;
declare var moment: any;
declare var rfc3339: string;
declare var blockAddressQueriedAt: any;
declare var bitcoinWebhook: string;
declare var bitcoinWebhookPassword: string;
declare function getRandomId(): any;
declare class BTCClient {
    address: string;
    username: string;
    password: string;
    inflight: number;
    inflightLimit: number;
    _fnQueue: {
        (): void;
    }[];
    constructor(address: string, username: string, password: string, inflightLimit?: number);
    _enqueue(fn: {
        (): void;
    }): void;
    _next(): void;
    rpc(...params: string[]): Promise<{}>;
}
declare function updateBloom(bloom: any, datastore: any, network: any): Promise<void>;
declare function toDatastoreArray(array: any, type: any): {
    values: any;
};
declare function saveReadingBlock(datastore: any, network: any, result: any): any[];
declare function savePendingBlockTransaction(datastore: any, blockHeight: any, transaction: any, vIn: any, vOut: any, vIdx: any, network: any, address: any, usage: any): any;
declare function getAndUpdateConfirmedBlockTransaction(client: any, datastore: any, network: any, number: any, confirmations: any): any;
declare var BloomFilter: any;
declare var Datastore: any;
declare var confirmations: any;
declare var inflightLimit: any;
declare function main(): Promise<void>;
