const { Web3 } = require("web3");

class Indexer {
  static MAXIMUM_BLOCK_RANGE = 3000;

  static bigIntAbs(bi) {
    return bi < 0n ? -bi : bi;
  }

  static async new(url, abi, contrHash, txHash) {
    let provider = new Web3.providers.HttpProvider(url);
    let web3 = new Web3(provider);
    let tx = await web3.eth.getTransaction(txHash);
    let data = Buffer.from(tx.data.substring(2), "hex").toString();
    let config = JSON.parse(data);
    let contr = new web3.eth.Contract(abi, contrHash);
    config.contr = contr;
    config.sig = contr._jsonInterface.find((i) => i.name === "Data").signature;
    config.from = Number(tx.blockNumber) + 1;
    return new Indexer(config);
  }

  constructor(config) {
    const { lim, blk, ext, mul, jpp, prc, rwd, mint, contr, sig, from } =
      config;
    this.limitPerMint = lim;
    this.blocksToEnd = blk;
    this.extraMintCount = ext;
    this.mulipliers = mul;
    this.jackpotPool = jpp;
    this.pricePerMint = prc;
    this.rewardPercent = rwd;
    this.mintData = mint;
    this.contract = contr;
    this.signature = sig;
    this.fromBlock = from;
  }

  getBlockRanges(toBlock) {
    let blockNumbers = ((start, stop, step) =>
      Array.from(
        { length: (stop - start) / step + 1 },
        (value, index) => start + index * step
      ))(this.fromBlock, Number(toBlock), Indexer.MAXIMUM_BLOCK_RANGE);
    blockNumbers.push(
      blockNumbers[blockNumbers.length - 1] + Indexer.MAXIMUM_BLOCK_RANGE
    );
    return blockNumbers
      .slice(0, -1)
      .map((blockNumber, i) => [blockNumber, blockNumbers[i + 1]]);
  }

  async indexETH(toBlock) {
    let blockRanges = this.getBlockRanges(toBlock);
    let eventsPerBlock = (
      await Promise.all(
        blockRanges.map(
          async (blockRange) =>
            await this.contract.getPastEvents("Data", {
              fromBlock: blockRange[0],
              toBlock: blockRange[1],
            })
        )
      )
    )
      .flatMap((event) => event)
      .map((event) => ({
        address: event.returnValues.account,
        // eslint-disable-next-line no-undef
        transactionHash: BigInt(event.transactionHash),
        blockNumber: Number(event.blockNumber),
      }))
      .reduce((events, event) => {
        if (!events.has(event.blockNumber))
          return events.set(event.blockNumber, [event]);
        events.get(event.blockNumber).push(event);
        return events;
      }, new Map());
    let eventValues = [...eventsPerBlock.values()].slice(0, this.blocksToEnd);
    return Array.from(
      { length: Math.ceil(eventValues.length / this.jackpotPool) },
      (v, i) =>
        eventValues.slice(
          i * this.jackpotPool,
          i * this.jackpotPool + this.jackpotPool
        )
    )
      .map((chunk) => chunk.flatMap((e) => e))
      .map((chunk) =>
        chunk.reduce((largest, current) => {
          let result =
            current.transactionHash > largest.transactionHash
              ? current
              : largest;
          let reward =
            (Web3.utils.toWei(this.pricePerMint, "ether") *
              chunk.length *
              this.rewardPercent) /
            100;
          return {
            ...result,
            reward: Number(Web3.utils.fromWei(reward, "ether")),
          };
        }, chunk[0])
      )
      .map((jackpot) => [jackpot.address, jackpot.reward]);
  }

  async indexToken(toBlock) {
    let blockRanges = await this.getBlockRanges(toBlock);
    let eventsPerBlock = (
      await Promise.all(
        blockRanges.map(
          async (blockRange) =>
            await this.contract.getPastEvents("Data", {
              fromBlock: blockRange[0],
              toBlock: blockRange[1],
            })
        )
      )
    )
      .flatMap((event) => event)
      .filter((event) => event.signature === this.signature)
      .filter((event) => event.returnValues.data === this.mintData)
      .map((event) => ({
        address: event.returnValues.account,
        // eslint-disable-next-line no-undef
        transactionHash: BigInt(event.transactionHash),
        // eslint-disable-next-line no-undef
        blockHash: BigInt(event.blockHash),
        blockNumber: Number(event.blockNumber),
      }))
      .reduce((events, event) => {
        if (!events.has(event.blockNumber))
          return events.set(event.blockNumber, [event]);
        events.get(event.blockNumber).push(event);
        return events;
      }, new Map());
    let mintPerBlock = [...eventsPerBlock.values()]
      .slice(0, this.blocksToEnd)
      .map((events) =>
        events.reduce(
          (closest, current) =>
            Indexer.bigIntAbs(current.transactionHash - current.blockHash) <
            Indexer.bigIntAbs(closest.transactionHash - closest.blockHash)
              ? current
              : closest,
          events[0]
        )
      );
    let len = this.blocksToEnd / this.mulipliers.length;
    let result = Array.from(
      { length: Math.ceil(mintPerBlock.length / len) },
      (v, i) => mintPerBlock.slice(i * len, i * len + len)
    )
      .map((chunk, i) =>
        chunk
          .sort((mint1, mint2) => (mint1.blockHash < mint2.blockHash ? 1 : -1))
          .map((mint, j) => ({
            ...mint,
            mint:
              (j < this.extraMintCount ? this.mulipliers[i] : 1) *
              this.limitPerMint,
          }))
      )
      .flatMap((mint) => mint)
      .map((mint) => ({
        address: mint.address,
        mint: mint.mint,
      }))
      .reduce((mints, mint) => {
        if (!mints.has(mint.address)) return mints.set(mint.address, mint.mint);
        mints.set(mint.address, mints.get(mint.address) + mint.mint);
        return mints;
      }, new Map());
    return [...result.entries()];
  }
}
