const { network, ethers } = require("hardhat")
const { developmentChains } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name) &&
    describe("Raffle Staging Tests", () => {
        let raffle, raffleEntranceFee, deployer
        beforeEach(async function () {
            deployer = (await getNamedAccounts()).deployer
            raffle = await ethers.getContract("Raffle", deployer)
            raffleEntranceFee = await raffle.getEntranceFee()
        })

        describe("fullfullRandomWords", () => {
            it("works with lice Chainlink Keepers and Chainlink VRF", async () => {
                // enter raffle
                console.log("Setting up test...")
                const startingTimeStamp = await raffle.getLastTimeStamp()
                const accounts = await ethers.getSigners()

                console.log("Setting up listener...")
                await new Promise(async (resolve, reject) => {
                    // setup listener before we enter the raffle
                    // just in case the blockchain moves really fast

                    raffle.once("WinnerPicked", async () => {
                        console.log("Winner is picked")
                        try {
                            const recentWinner = await raffle.getRecentWinner()
                            const raffleState = await raffle.getRaffleState()
                            const winnerEndingBalance = await accounts[0].getBalance()
                            const endingTimeStamp = await raffle.getLastTimeStamp()
                            await expect(raffle.getPlayer(0)).to.be.reverted
                            assert.equal(recentWinner.toString(), accounts[0].address)
                            assert.equal(raffleState, 0)
                            assert.equal(
                                winnerEndingBalance.toString(),
                                winnerStartingBalance.add(raffleEntranceFee).toString()
                            )
                            assert(endingTimeStamp > startingTimeStamp)
                            resolve()
                        } catch (error) {
                            console.log(error)
                            reject(error)
                        }
                    })
                    // Then entering the raffle
                    console.log("Entering Raffle...")
                    const tx = await raffle.enterRaffle({ value: raffleEntranceFee })
                    await tx.wait(1)
                    console.log("Ok, time to wait...")
                    const winnerStartingBalance = await accounts[0].getBalance()

                    // and this code WONT complete until our listener has finished
                })
            })
        })
    })
