import asyncio
import sys
import os
sys.path.append('/mnt/c/Users/JordanBaillie/OneDrive - FD Intelligence/Documents/FDIChatbotWebsite/Python Code')

from log_service import log_service

async def test_logging():
    print("Testing logging functionality...")
    
    # Test create log
    question_id = await log_service.create_question_log("test-conv-123", "test-user-456")
    print(f"Created log with ID: {question_id}")
    
    if question_id:
        # Test update model choices
        await log_service.update_question_log_models(question_id, ["General"])
        print("Updated model choices")
        
        # Test update response timestamp
        await log_service.update_question_log_response(question_id)
        print("Updated response timestamp")
        
        # Test update errors
        await log_service.update_question_log_errors(question_id, ["TestError: This is a test"])
        print("Updated errors")
    
    print("Test complete")

if __name__ == "__main__":
    asyncio.run(test_logging())