import "dotenv/config";
import { ethers } from "ethers";

const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = "0xAC7b5d06fa1e77D08aea40d46cB7C5923A87A0cc";

const ABI = [
  "function miningState() view returns (uint256 era,uint256 reward,uint256 difficulty,uint256 minted,uint256 remaining,uint256 epoch,uint256 epochBlocksLeft_)",
  "function genesisState() view returns (uint256,uint256,uint256,bool)",
];

if (!RPC_URL) {
  console.error("Isi RPC_URL di file .env dulu.");
  process.exit(1);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

  const genesisState = await contract.genesisState();
  const miningState = await contract.miningState();

  console.log("Contract:", CONTRACT_ADDRESS);
  console.log("");
  console.log("── Genesis ──");
  console.log("genesisState:", genesisState);
  console.log("");
  console.log("── Mining State ──");
  console.log("Era:", miningState.era.toString());
  console.log("Reward:", ethers.formatUnits(miningState.reward, 18), "HASH");
  console.log("Difficulty:", miningState.difficulty.toString());
  console.log("Minted:", miningState.minted.toString());
  console.log("Remaining:", miningState.remaining.toString());
  console.log("Epoch:", miningState.epoch.toString());
  console.log("Epoch Blocks Left:", miningState.epochBlocksLeft_.toString());
}

main().catch((err) => {
  console.error(err.shortMessage || err.message || err);
  process.exit(1);
});
