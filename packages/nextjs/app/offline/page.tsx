import Image from "next/image";

export default function OfflinePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <div className="max-w-md mx-auto">
        <Image src="/miner.png" alt="CryptoHunter" width={128} height={128} className="mx-auto mb-6" />
        <h1 className="text-2xl font-bold mb-4">You&apos;re Offline</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          It looks like you&apos;re not connected to the internet. Don&apos;t worry, you can still explore the cached
          content!
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
