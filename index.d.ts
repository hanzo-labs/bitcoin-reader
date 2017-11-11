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
    constructor(address: string, username: string, password: string);
    rpc(...params: string[]): any;
}
declare function updateBloom(bloom: any, datastore: any, network: any): Promise<void>;
declare function toDatastoreArray(array: any, type: any): {
    values: any;
};
declare function saveReadingBlock(datastore: any, network: any, result: any): any[];
declare function updatePendingBlock(datastore: any, data: any): any;
declare function getAndUpdateConfirmedBlock(datastore: any, network: any, number: any, confirmations: any): any;
declare function savePendingBlockTransaction(datastore: any, transaction: any, network: any, address: any, usage: any): any;
declare function getAndUpdateConfirmedBlockTransaction(web3: any, datastore: any, network: any, number: any, confirmations: any): any;
declare var BloomFilter: any;
declare var Datastore: any;
declare var confirmations: any;
declare var inflightLimit: any;
declare function main(): Promise<void>;
