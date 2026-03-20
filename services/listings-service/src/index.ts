import "dotenv/config";
import { startGrpcServer } from "./grpc-server.js";

const port = Number(process.env.PORT || 50052);
startGrpcServer(port);
console.log(`Listings service gRPC server running on port ${port}`);
