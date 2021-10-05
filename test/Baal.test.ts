import { ethers } from 'hardhat'
import { solidity } from 'ethereum-waffle'
import { use, expect } from 'chai'
import { PolyjuiceWallet, PolyjuiceJsonRpcProvider } from '@polyjuice-provider/ethers';

import {
  Baal,
  TestErc20,
  RageQuitBank,
  BaalFactory,
  TestErc20Factory,
  RageQuitBankFactory
} from '../src/types';
import { NERVOS_PROVIDER_URL, USER_ONE_PRIVATE_KEY } from '../src/config';
import { BigNumberish } from 'ethers';
import { AddressTranslator } from 'nervos-godwoken-integration';

use(solidity)

const IS_TESTNET = false;

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const waitForNetwork = () => {
  if (IS_TESTNET) {
    return wait(10000)
  }

  return wait(500);
};

const revertMessages =  {
  molochConstructorShamanCannotBe0: 'shaman cannot be 0',
  molochConstructorGuildTokenCannotBe0: 'guildToken cannot be 0',
  molochConstructorSummonerCannotBe0: 'summoner cannot be 0',
  molochConstructorSharesCannotBe0: 'shares cannot be 0',
  molochConstructorMinVotingPeriodCannotBe0: 'minVotingPeriod cannot be 0',
  molochConstructorMaxVotingPeriodCannotBe0: 'maxVotingPeriod cannot be 0',
  submitProposalVotingPeriod: '!votingPeriod',
  submitProposalArrays: '!array parity',
  submitProposalArrayMax: 'array max',
  submitProposalFlag: '!flag',
  submitVoteTimeEnded: 'ended',
  proposalMisnumbered: '!exist'
}

const zeroAddress = '0x0000000000000000000000000000000000000000';

async function moveForwardPeriods(periods: number) {
  const goToTime = deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS * periods;
  await ethers.provider.send('evm_increaseTime', [goToTime]);
  return true;
}

const nervosProviderConfig = {
  web3Url: NERVOS_PROVIDER_URL
};

const deploymentConfig = {
  'GRACE_PERIOD_IN_SECONDS': 80,
  MIN_VOTING_PERIOD_IN_SECONDS: 110,
  MAX_VOTING_PERIOD_IN_SECONDS: 220,
  'TOKEN_NAME': 'wrapped ETH',
  'TOKEN_SYMBOL': 'WETH',
}

const rpc = new PolyjuiceJsonRpcProvider(nervosProviderConfig, nervosProviderConfig.web3Url);
const summoner = new PolyjuiceWallet(USER_ONE_PRIVATE_KEY, nervosProviderConfig, rpc);

async function blockTime() {
  const block = await rpc.getBlock('latest')
  return block.timestamp;
}

const addressTranslator = new AddressTranslator({
  RPC_URL: NERVOS_PROVIDER_URL,
  CKB_URL: '',
  INDEXER_URL: '',
  deposit_lock_script_type_hash: '',
  eth_account_lock_script_type_hash: '0xe8bb99adf14fbe8394ff8562ac990445fd51f34e29216a41d514d80af9ce32cf',
  portal_wallet_lock_hash: '',
  rollup_type_hash: '0xd8e81522b747cba430ad442787412fb7413aa2189bc7cc4e53762dff02acd6f9',
  rollup_type_script: {
    args: '',
    code_hash: '',
    hash_type: ''
  }
});
const summonerPolyAddress = addressTranslator.ethAddressToGodwokenShortAddress(summoner.address);

async function deployERC20(name: string, symbol: string, totalSupply: BigNumberish) {
    const implementationFactory = new TestErc20Factory(summoner);
    const tx = implementationFactory.getDeployTransaction(name, symbol, totalSupply);
    const receipt = await (await summoner.sendTransaction(tx)).wait();
    const contract = TestErc20Factory.connect(receipt.contractAddress, summoner);

    // console.log(`ERC20 deployed at: ${contract.address}`);

    return contract;
}

async function deployRageQuitBank() {
    const implementationFactory = new RageQuitBankFactory(summoner);
    const tx = implementationFactory.getDeployTransaction();
    const receipt = await (await summoner.sendTransaction(tx)).wait();
    const contract = RageQuitBankFactory.connect(receipt.contractAddress, summoner);

    // console.log(`RageQuitBank deployed at: ${contract.address}`);

    return contract;
}

async function expectRevert(testedCode: () => Promise<any>, expect: any) {
  const EXPECTED_ERROR = 'invalid exit code 2';

  try {
    await testedCode();
  } catch (error) {
    expect((error as any).error.body).contains(EXPECTED_ERROR);
  }
}

async function waitForBlockWithGreaterTimestamp(timestamp: number) {
  while (timestamp >= await blockTime()) {
    await wait(5000);
  }
}

describe('Baal contract', function () {
  let baal: Baal;
  let weth: TestErc20
  let shaman: RageQuitBank;
  
  let proposal: { [key: string]: any};

  const loot = 500;
  const shares = 100;
  const sharesPaused = false;

  const yes = true;
  const no = false;

  async function deployBaal(weth: TestErc20, shaman: RageQuitBank) {
    const factory = new BaalFactory(summoner);
  
    const tx = factory.getDeployTransaction(
        sharesPaused,
        deploymentConfig.GRACE_PERIOD_IN_SECONDS,
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS,
        deploymentConfig.TOKEN_NAME,
        deploymentConfig.TOKEN_SYMBOL,
        [weth.address],
        [shaman.address],
        [summonerPolyAddress],
        [loot],
        [shares]
    );
    const receipt = await (await summoner.sendTransaction(tx)).wait();
    const Baal = BaalFactory.connect(receipt.contractAddress, summoner);
  
    // console.log('Baal deploy', {
    //   blockNumber: receipt.blockNumber,
    //   contractAddress: Baal.address
    // });

    return Baal;
  }

  beforeEach(async function () {
    weth = (await deployERC20("WETH", "WETH", 10000000)) as TestErc20;

    shaman = (await deployRageQuitBank()) as RageQuitBank;
    
    baal = await deployBaal(weth, shaman);

    await shaman.init(
      baal.address
    );

    proposal = {
      flag: 0,
      votingPeriod: deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS,
      account: summonerPolyAddress,
      value: 50,
      data: 10,
      details: 'all hail baal'
    }

    await waitForNetwork();
  });

  afterEach(async function () {
    await waitForNetwork();
  });

  describe('constructor', function () {
    it('verify deployment parameters', async function () {
      const decimals = await baal.decimals();
      expect(decimals).to.equal(18);

      const gracePeriod = await baal.gracePeriod();
      expect(gracePeriod).to.equal(deploymentConfig.GRACE_PERIOD_IN_SECONDS);
      
      const minVotingPeriod = await baal.minVotingPeriod();
      expect(minVotingPeriod).to.equal(deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS);

      const maxVotingPeriod = await baal.maxVotingPeriod();
      expect(maxVotingPeriod).to.equal(deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS);

      const name = await baal.name();
      expect(name).to.equal(deploymentConfig.TOKEN_NAME);

      const symbol = await baal.symbol();
      expect(symbol).to.equal(deploymentConfig.TOKEN_SYMBOL);

      const lootPaused = await baal.lootPaused();
      expect(lootPaused).to.be.false;
  
      const sharesPaused = await baal.sharesPaused();
      expect(sharesPaused).to.be.false;

      const shamans = await baal.shamans(shaman.address);
      expect(shamans).to.be.true;

      const guildTokens = await baal.getGuildTokens();
      expect(guildTokens[0]).to.equal(weth.address);

      const summonerData = await baal.members(summonerPolyAddress);
      expect(summonerData.loot).to.equal(500);
      expect(summonerData.highestIndexYesVote).to.equal(0);

      const totalLoot = await baal.totalLoot();
      expect(totalLoot).to.equal(500);
    });
  });

  describe('memberAction', function () {
    it('happy case - verify loot', async function () {
      await (await baal.memberAction(shaman.address, loot / 2, shares / 2, true)).wait();

      const lootData = await baal.members(summonerPolyAddress);
      expect(lootData.loot).to.equal(1000);
    });

    it('happy case - verify shares', async function () {
      await (await baal.memberAction(shaman.address, loot / 2, shares / 2, true)).wait();
      const sharesData = await baal.balanceOf(summonerPolyAddress);
      expect(sharesData).to.equal(200);
    });
  });
  
  describe('submitProposal', function () {
    it('happy case', async function () {
      const countBefore = await baal.proposalCount();

      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const countAfter = await baal.proposalCount();

      expect(countAfter).to.equal(countBefore.add(1));
    });

    it('require fail - voting period too low', async function() {
      expectRevert(() => 
        baal.submitProposal(
          proposal.flag,
          deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS - 100,
          [proposal.account], 
          [proposal.value],
          [proposal.data],
          ethers.utils.id(proposal.details)
        )
      , expect);
    });

    it('require fail - voting period too high', async function() { 
      expectRevert(() => baal.submitProposal(
        proposal.flag,
        deploymentConfig.MAX_VOTING_PERIOD_IN_SECONDS + 100,
        [proposal.account], 
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      ), expect);
    });

    it('require fail - to array does not match', async function() { 
      expectRevert(() => baal.submitProposal(
        proposal.flag,
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS + 100,
        [proposal.account, summonerPolyAddress], 
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      ), expect);
    });

    it('require fail - value array does not match', async function() { 
      expectRevert(() => baal.submitProposal(
        proposal.flag,
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS + 100,
        [proposal.account, summonerPolyAddress], 
        [proposal.value, 20],
        [proposal.data],
        ethers.utils.id(proposal.details)
        ), expect);
    });

    it('require fail - data array does not match', async function() { 
      expectRevert(() => baal.submitProposal(
        proposal.flag,
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS + 100,
        [proposal.account, summonerPolyAddress], 
        [proposal.value],
        [proposal.data, 15],
        ethers.utils.id(proposal.details)
        ), expect);
    });

    it('require fail - flag is out of bounds', async function() { 
      expectRevert(() => baal.submitProposal(
        6,
        deploymentConfig.MIN_VOTING_PERIOD_IN_SECONDS + 100,
        [proposal.account, summonerPolyAddress], 
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
        ), expect);
    });
  });

  describe('submitVote', function () {
    beforeEach(async function () {
      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const propBefore = await baal.proposals(1);

      await waitForBlockWithGreaterTimestamp(propBefore.votingStarts);
    });

    it('happy case - yes vote', async function() {
      // const blockT = await blockTime();

      await (await baal.submitVote(1, yes)).wait();

      const prop = await baal.proposals(1);
      // const priorVote = await baal.getPriorVotes(summonerPolyAddress, blockT);
      const nCheckpoints = await baal.numCheckpoints(summonerPolyAddress);
      const votes = (await baal.checkpoints(summonerPolyAddress, nCheckpoints.sub(1))).votes;
      expect(prop.yesVotes).to.equal(votes);
    });

    it('happy case - no vote', async function() {
      // const blockT = await blockTime();
      await (await baal.submitVote(1, no)).wait();

      const prop = await baal.proposals(1);
      // const priorVote = await baal.getPriorVotes(summonerPolyAddress, blockT);
      const nCheckpoints = await baal.numCheckpoints(summonerPolyAddress);
      const votes = (await baal.checkpoints(summonerPolyAddress, nCheckpoints.sub(1))).votes;
      expect(prop.noVotes).to.equal(votes);
    });

    it('require fail - voting period has ended', async function() {
      const propBefore = await baal.proposals(1);

      await waitForBlockWithGreaterTimestamp(propBefore.votingEnds);

      expectRevert(() => baal.submitVote(1, no), expect);
    });
  });

  describe('processProposal', function () {
    it('happy case - flag[0] - yes wins', async function () {
      const beforeProcessed = await baal.proposals(1);

      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const submittedProposal = await baal.proposals(1);

      await waitForBlockWithGreaterTimestamp(submittedProposal.votingStarts);

      await (await baal.submitVote(1, yes)).wait();

      await waitForBlockWithGreaterTimestamp(submittedProposal.votingEnds);

      await (await baal.processProposal(1)).wait();
      const afterProcessed = await baal.proposals(1);

      expect(afterProcessed).to.deep.equal(beforeProcessed);
    });

    it('happy case - flag[1] - yes wins', async function () {
      await (await baal.submitProposal(
        proposal.flag + 1,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const beforeProcessed = await baal.proposals(1);

      await waitForBlockWithGreaterTimestamp(beforeProcessed.votingStarts);

      const lootBefore = (await baal.members(proposal.account)).loot;
      await (await baal.submitVote(1, yes)).wait();
      const yesVotes = (await baal.proposals(1)).yesVotes;
      await waitForBlockWithGreaterTimestamp(beforeProcessed.votingEnds);
      await (await baal.processProposal(1)).wait();
      const lootAfter = (await baal.members(proposal.account)).loot;
      expect(lootAfter).to.equal(lootBefore.add(yesVotes));
    });

    it('happy case - flag[2] - yes wins', async function () {
      const beforeProcessed = await baal.proposals(1);
      await (await baal.submitProposal(
        proposal.flag + 2,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value, 0, 0, 0, 0, 0],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();
      const submittedProposal = await baal.proposals(1);
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingStarts);
      await (await baal.submitVote(1, yes)).wait();
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingEnds);
      await (await baal.processProposal(1)).wait();
      const afterProcessed = await baal.proposals(1);
      expect(afterProcessed).to.deep.equal(beforeProcessed);
    });

    it('happy case - flag[3] - yes wins', async function () {
      const beforeProcessed = await baal.proposals(1);
      await (await baal.submitProposal(
        proposal.flag + 3,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();
      const submittedProposal = await baal.proposals(1);
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingStarts);
      await (await baal.submitVote(1, yes)).wait();
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingEnds);
      await (await baal.processProposal(1)).wait();
      const afterProcessed = await baal.proposals(1);
      expect(afterProcessed).to.deep.equal(beforeProcessed);
    });

    it('happy case - flag[0] - no wins', async function () {
      const beforeProcessed = await baal.proposals(1);
      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();
      const submittedProposal = await baal.proposals(1);
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingStarts);
      await (await baal.submitVote(1, no)).wait();
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingEnds);
      await (await baal.processProposal(1)).wait();
      const afterProcessed = await baal.proposals(1);
      expect(afterProcessed).to.deep.equal(beforeProcessed);
    });

    it('happy case - flag[1] - no wins', async function () {
      await (await baal.submitProposal(
        proposal.flag + 1,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();
      const lootBefore = (await baal.members(proposal.account)).loot;
      const submittedProposal = await baal.proposals(1);
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingStarts);
      await (await baal.submitVote(1, no)).wait();
      const noVotes = (await baal.proposals(1)).noVotes;
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingEnds);
      await (await baal.processProposal(1)).wait();
      const lootAfter = (await baal.members(proposal.account)).loot;
      expect(lootAfter).to.equal(lootBefore.add(noVotes));
    });

    it('happy case - flag[2] - no wins', async function () {
      const beforeProcessed = await baal.proposals(1);
      await (await baal.submitProposal(
        proposal.flag + 2,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value, 0, 0, 0, 0, 0],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();
      const submittedProposal = await baal.proposals(1);
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingStarts);
      await (await baal.submitVote(1, no)).wait();
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingEnds);
      await (await baal.processProposal(1)).wait();
      const afterProcessed = await baal.proposals(1);
      expect(afterProcessed).to.deep.equal(beforeProcessed);
    });

    it('require fail - proposal does not exist', async function () {
      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();
      const submittedProposal = await baal.proposals(1);
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingStarts);
      await (await baal.submitVote(1, yes)).wait();
      await waitForBlockWithGreaterTimestamp(submittedProposal.votingEnds);
      expectRevert(() => baal.processProposal(2), expect);
    });

    it('require fail - voting period has not ended', async function () {
      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();
      
      const submittedProposal1 = await baal.proposals(1);
      await waitForBlockWithGreaterTimestamp(submittedProposal1.votingStarts);
      await (await baal.submitVote(1, yes)).wait();
      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();
      const submittedProposal2 = await baal.proposals(2);
      await waitForBlockWithGreaterTimestamp(submittedProposal2.votingStarts);
      await (await baal.submitVote(2, yes)).wait();
      await waitForBlockWithGreaterTimestamp(submittedProposal1.votingEnds);
      expectRevert(() => baal.processProposal(2), expect);
    });
  });

  describe('ragequit', function () {
    beforeEach(async function () {
      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const propBefore = await baal.proposals(1);

      await waitForBlockWithGreaterTimestamp(propBefore.votingStarts);
    });

    it('happy case - full ragequit', async function () {
      const lootBefore = (await baal.members(summonerPolyAddress)).loot;
      await (await baal.ragequit(summonerPolyAddress, loot, shares)).wait();
      const lootAfter = (await baal.members(summonerPolyAddress)).loot;
      expect(lootAfter).to.equal(lootBefore.sub(loot));
    });

    it('happy case - partial ragequit', async function () {
      const lootBefore = (await baal.members(summonerPolyAddress)).loot;
      const lootToBurn = 200;
      const sharesToBurn = 70;
      await (await baal.ragequit(summonerPolyAddress, lootToBurn, sharesToBurn)).wait();
      const lootAfter = (await baal.members(summonerPolyAddress)).loot;
      expect(lootAfter).to.equal(lootBefore.sub(lootToBurn));
    });

    it('require fail - proposal voting has not ended', async function () {
      const lootBefore = (await baal.members(summonerPolyAddress)).loot;
      await (await baal.submitVote(1, yes)).wait();
      expectRevert(() => baal.ragequit(summonerPolyAddress, loot, shares), expect);
    });
  });

  describe('getCurrentVotes', function () {
    it('happy case - account with votes', async function () {
      const currentVotes = await baal.getCurrentVotes(summonerPolyAddress);
      const nCheckpoints = await baal.numCheckpoints(summonerPolyAddress);
      const checkpoints = await baal.checkpoints(summonerPolyAddress, nCheckpoints.sub(1));
      const votes = checkpoints.votes;
      expect(currentVotes).to.equal(votes);
    });

    it('happy case - account without votes', async function () {
      const currentVotes = await baal.getCurrentVotes(shaman.address);
      expect(currentVotes).to.equal(0);
    });
  });

  describe('getPriorVotes', function () {
    beforeEach(async function () {
      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const propBefore = await baal.proposals(1);
      await waitForBlockWithGreaterTimestamp(propBefore.votingStarts);
    });

    it('happy case - yes vote', async function (){
      const blockT = await blockTime();
      await (await baal.submitVote(1, yes)).wait();
      const priorVote = await baal.getPriorVotes(summonerPolyAddress, blockT);
      const nCheckpoints = await baal.numCheckpoints(summonerPolyAddress);
      const votes = (await baal.checkpoints(summonerPolyAddress, nCheckpoints.sub(1))).votes;
      expect(priorVote).to.equal(votes);
    });

    it('happy case - no vote', async function (){
      const blockT = await blockTime();
      await (await baal.submitVote(1, no)).wait();
      const priorVote = await baal.getPriorVotes(summonerPolyAddress, blockT);
      const nCheckpoints = await baal.numCheckpoints(summonerPolyAddress);
      const votes = (await baal.checkpoints(summonerPolyAddress, nCheckpoints.sub(1))).votes;
      expect(priorVote).to.equal(votes);
    });

    it('require fail - timestamp not determined', async function () {
      const blockT = await blockTime();
      expectRevert(() => baal.getPriorVotes(summonerPolyAddress, blockT), expect);
    });
  });

  describe('getProposalFlags', function () {
    it('happy case - action type', async function (){
      await (await baal.submitProposal(
        proposal.flag,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const flags = await baal.getProposalFlags(1);
      expect(flags[proposal.flag]).to.be.true;
    });

    it('happy case - membership type', async function (){
      await (await baal.submitProposal(
        proposal.flag + 1,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const flags = await baal.getProposalFlags(1);
      expect(flags[proposal.flag + 1]).to.be.true;
    });

    it('happy case - period type', async function (){
      await (await baal.submitProposal(
        proposal.flag + 2,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value, 0, 0, 0, 0, 0],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const flags = await baal.getProposalFlags(1);
      expect(flags[proposal.flag + 2]).to.be.true;
    });

    it('happy case - whitelist type', async function (){
      await (await baal.submitProposal(
        proposal.flag + 3,
        proposal.votingPeriod,
        [proposal.account],
        [proposal.value],
        [proposal.data],
        ethers.utils.id(proposal.details)
      )).wait();

      const flags = await baal.getProposalFlags(1);
      expect(flags[proposal.flag + 3]).to.be.true;
    });
  });
});
