/* eslint-disable @typescript-eslint/camelcase */
import { PolyjuiceWallet, PolyjuiceJsonRpcProvider } from '@polyjuice-provider/ethers';
import { BigNumberish } from 'ethers';

import {
    BaalFactory,
    TestErc20Factory,
    RageQuitBankFactory
} from './types';
import { NERVOS_PROVIDER_URL, USER_ONE_PRIVATE_KEY } from './config';

const nervosProviderConfig = {
    web3Url: NERVOS_PROVIDER_URL
};

const loot = 500;
const shares = 100;
const sharesPaused = false;

const deploymentConfig = {
    'GRACE_PERIOD_IN_SECONDS': 43200,
    'MIN_VOTING_PERIOD_IN_SECONDS': 172800,
    'MAX_VOTING_PERIOD_IN_SECONDS': 432000,
    'TOKEN_NAME': 'wrapped ETH',
    'TOKEN_SYMBOL': 'WETH',
};


const rpc = new PolyjuiceJsonRpcProvider(nervosProviderConfig, nervosProviderConfig.web3Url);
const summoner = new PolyjuiceWallet(USER_ONE_PRIVATE_KEY, nervosProviderConfig, rpc);

async function deployERC20(name: string, symbol: string, totalSupply: BigNumberish, existing = true) {
    if (existing) {
        return TestErc20Factory.connect('0x08d54a1ed73BB13Ec540B1F5835e2eb6489Fbb76', summoner);
    }

    const implementationFactory = new TestErc20Factory(summoner);
    const tx = implementationFactory.getDeployTransaction(name, symbol, totalSupply);
    const receipt = await (await summoner.sendTransaction(tx)).wait();
    const contract = TestErc20Factory.connect(receipt.contractAddress, summoner);

    console.log(`ERC20 deployed at: ${contract.address}`);

    return contract;
}

async function deployRageQuitBank(existing = true) {
    if (existing) {
        return RageQuitBankFactory.connect('0xB58b1b400f2Cb8E40B33757d0c9DD0Eb3864e024', summoner);
    }

    const implementationFactory = new RageQuitBankFactory(summoner);
    const tx = implementationFactory.getDeployTransaction();
    const receipt = await (await summoner.sendTransaction(tx)).wait();
    const contract = RageQuitBankFactory.connect(receipt.contractAddress, summoner);

    console.log(`RageQuitBank deployed at: ${contract.address}`);

    return contract;
}

async function deployBaal() {
    const factory = new BaalFactory(summoner);

    const weth = await deployERC20("WETH", "WETH", 10000000);
    const shaman = await deployRageQuitBank();

    const tx = factory.getDeployTransaction(
        sharesPaused,
        deploymentConfig.GRACE_PERIOD_IN_SECONDS,
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.TOKEN_NAME,
        deploymentConfig.TOKEN_SYMBOL,
        [weth.address],
        [shaman.address],
        [summoner.address],
        [loot],
        [shares]
    );
    const receipt = await (await summoner.sendTransaction(tx)).wait();
    const Baal = BaalFactory.connect(receipt.contractAddress, summoner);

	console.log('Contract Address:', Baal.address);
	console.log('Block Number:', receipt.blockNumber);
}

async function runDemo() {
	const address = await summoner.getAddress();
	console.log('Summoning a Baal on network: Nervos Layer 2 Testnet');
	console.log('Account address:', address);
	console.log(
		'Account balance:',
		await summoner.provider.getBalance(address),
		'CKB'
	);

    await deployBaal();

    process.exit(0);
}

(async () => {
    await runDemo();
})();

