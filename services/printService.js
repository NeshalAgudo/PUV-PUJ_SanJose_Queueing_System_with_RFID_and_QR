const print = require('printer');

const printService = {
  printTicket: async (ticketData) => {
    try {
      // Format ticket content - minimal and clean
      const ticketContent = `
T.C.P.U.S
SanJose City
Date: ${new Date().toLocaleDateString()}
${ticketData.queueNumber ? `Queue: ${ticketData.queueNumber}` : ''}
${ticketData.route ? `Route: ${ticketData.route}` : ''}
${ticketData.FD ? `${ticketData.FD}` : ''}
${ticketData.pass ? `${ticketData.pass}` : ''}
Time In: ${ticketData.timeIn.toLocaleTimeString()}
${ticketData.timeOut ? `Time Out: ${ticketData.timeOut.toLocaleTimeString()}` : ''}

`.trim(); // Remove leading/trailing whitespace

      // Print to default printer
      print.printDirect({
        data: ticketContent,
        printer: process.env.PRINTER_NAME || '', // Use system default if not specified
        type: 'TEXT',
        success: (jobID) => console.log(`Printed ticket with job ID: ${jobID}`),
        error: (err) => console.error('Print error:', err)
      });
      
      return true;
    } catch (error) {
      console.error('Print error:', error);
      throw error;
    }
  }
};

module.exports = printService;